import { v4 as uuidv4 } from 'uuid';
import { createEvent, listEvents } from '@/lib/calendar/events';
import { isSlotFree, eventsOverlappingRange } from '@/lib/calendar/slot-search';
import { formatTimeSlot } from '@/lib/calendar/utils';
import { entriesFingerprint } from '@/lib/agent/booking-days';
import type { DebugLogger } from '@/lib/debug';
import type {
  BookingJob,
  BookingJobItem,
  BookingProgressSnapshot,
  CalendarEvent,
} from '@/types';

export interface BookingJobEntryInput {
  day: string;
  start: string;
  end: string;
  summary: string;
}

export interface InitBookingJobResult {
  job: BookingJob;
  jobId: string;
  total: number;
  hint: string;
}

export interface InitBookingJobBlocked {
  error: 'job_already_done';
  message: string;
  progress: BookingProgressSnapshot;
}

export interface ExecuteBookingBatchResult {
  job: BookingJob;
  progress: BookingProgressSnapshot;
  bookedThisBatch: number;
  failedThisBatch: number;
  reconciledThisBatch: number;
  done: boolean;
  hint: string;
}

const DEFAULT_BATCH_SIZE = 5;

function sameSlot(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart === bStart && aEnd === bEnd;
}

function findMatchingEvent(
  item: BookingJobItem,
  calendarEvents: CalendarEvent[]
): CalendarEvent | undefined {
  const overlapping = eventsOverlappingRange(
    calendarEvents,
    item.start,
    item.end
  );
  return overlapping.find(
    e =>
      e.start?.dateTime &&
      e.end?.dateTime &&
      (sameSlot(item.start, item.end, e.start.dateTime, e.end.dateTime) ||
        (e.summary ?? '').toLowerCase() === item.summary.toLowerCase())
  );
}

async function reconcilePendingItem(
  item: BookingJobItem,
  calendarEvents: CalendarEvent[]
): Promise<{ item: BookingJobItem; action: 'already_booked' | 'pending' }> {
  if (item.eventId) {
    return {
      item: { ...item, status: 'booked' },
      action: 'already_booked',
    };
  }

  const match = findMatchingEvent(item, calendarEvents);
  if (match?.id && match.start?.dateTime && match.end?.dateTime) {
    return {
      item: {
        ...item,
        status: 'booked',
        eventId: match.id,
        error: undefined,
      },
      action: 'already_booked',
    };
  }

  return { item, action: 'pending' };
}

async function entriesAlreadyOnCalendar(entries: BookingJobEntryInput[]): Promise<boolean> {
  if (entries.length === 0) return false;
  const rangeStart = entries.reduce(
    (min, e) => (e.start < min ? e.start : min),
    entries[0].start
  );
  const rangeEnd = entries.reduce(
    (max, e) => (e.end > max ? e.end : max),
    entries[0].end
  );
  const calendarEvents = await listEvents(rangeStart, rangeEnd, undefined, undefined, 50);
  return entries.every(e => {
    const pseudo: BookingJobItem = {
      day: e.day,
      start: e.start,
      end: e.end,
      summary: e.summary,
      status: 'pending',
    };
    return !!findMatchingEvent(pseudo, calendarEvents);
  });
}

function completedProgressForEntries(
  entries: BookingJobEntryInput[],
  timezone: string,
  existingJob?: BookingJob | null
): BookingProgressSnapshot {
  if (existingJob) {
    const progress = getBookingProgress(existingJob);
    if (
      existingJob.status === 'completed' ||
      (progress.booked > 0 && progress.pending === 0)
    ) {
      return progress;
    }
  }

  const items: BookingJobItem[] = entries.map(e => ({
    day: e.day,
    start: e.start,
    end: e.end,
    summary: e.summary,
    status: 'booked',
    display: formatTimeSlot({ start: e.start, end: e.end }, timezone),
  }));

  const job: BookingJob = {
    id: existingJob?.id ?? 'completed',
    status: 'completed',
    items,
    updatedAt: new Date().toISOString(),
    entriesFingerprint: entriesFingerprint(entries),
  };
  return getBookingProgress(job);
}

/** Server-side gate: block re-init after success or when calendar already has the events. */
export async function evaluateInitBookingBlock(
  entries: BookingJobEntryInput[],
  timezone: string,
  existingJob?: BookingJob | null,
  force?: boolean
): Promise<InitBookingJobBlocked | null> {
  if (force || entries.length === 0) return null;

  if (existingJob) {
    const progress = getBookingProgress(existingJob);
    if (existingJob.status === 'completed') {
      return {
        error: 'job_already_done',
        message: `All ${progress.total} meeting(s) are already booked. Do not call init_booking_job again.`,
        progress,
      };
    }
    if (progress.booked > 0 && progress.pending === 0) {
      return {
        error: 'job_already_done',
        message: `All ${progress.booked} meeting(s) are already booked. Do not call init_booking_job again.`,
        progress,
      };
    }
    const fp = entriesFingerprint(entries);
    if (existingJob.entriesFingerprint === fp && existingJob.status === 'in_progress') {
      return {
        error: 'job_already_done',
        message:
          'A booking job for these days is already in progress. Wait for progress UI to finish.',
        progress,
      };
    }
  }

  if (await entriesAlreadyOnCalendar(entries)) {
    const progress = completedProgressForEntries(entries, timezone, existingJob);
    return {
      error: 'job_already_done',
      message: `All ${entries.length} slot(s) already exist on the calendar. Do not re-initialize.`,
      progress,
    };
  }

  return null;
}

export async function initBookingJob(
  entries: BookingJobEntryInput[],
  timezone: string = 'UTC',
  existingJob?: BookingJob | null,
  force?: boolean
): Promise<InitBookingJobResult | InitBookingJobBlocked> {
  const blocked = await evaluateInitBookingBlock(entries, timezone, existingJob, force);
  if (blocked) return blocked;

  const fp = entriesFingerprint(entries);

  const items: BookingJobItem[] = entries.map(e => ({
    day: e.day,
    start: e.start,
    end: e.end,
    summary: e.summary,
    status: 'pending',
    display: formatTimeSlot({ start: e.start, end: e.end }, timezone),
  }));

  const job: BookingJob = {
    id: uuidv4(),
    status: items.length > 0 ? 'in_progress' : 'completed',
    items,
    updatedAt: new Date().toISOString(),
    entriesFingerprint: fp,
    sseInProgress: false,
  };

  return {
    job,
    jobId: job.id,
    total: items.length,
    hint:
      items.length === 0
        ? 'No entries to book.'
        : 'Job initialized. The client will book remaining days via progress UI. Do not call init_booking_job again.',
  };
}

export function getBookingProgress(job: BookingJob): BookingProgressSnapshot {
  const total = job.items.length;
  const booked = job.items.filter(i => i.status === 'booked').length;
  const failed = job.items.filter(i => i.status === 'failed').length;
  const skipped = job.items.filter(i => i.status === 'skipped').length;
  const pending = job.items.filter(i => i.status === 'pending').length;
  const finished = booked + failed + skipped;
  const percent = total === 0 ? 100 : Math.round((finished / total) * 100);

  return {
    jobId: job.id,
    status: job.status,
    total,
    booked,
    failed,
    pending,
    skipped,
    percent,
    items: job.items,
  };
}

function finalizeJobStatus(job: BookingJob): BookingJob {
  const pending = job.items.some(i => i.status === 'pending');
  if (pending) {
    return { ...job, status: 'in_progress', updatedAt: new Date().toISOString() };
  }
  const hasFailed = job.items.some(i => i.status === 'failed');
  return {
    ...job,
    status: hasFailed ? 'failed' : 'completed',
    updatedAt: new Date().toISOString(),
    sseInProgress: false,
  };
}

export async function executeBookingBatch(
  job: BookingJob,
  batchSize: number = DEFAULT_BATCH_SIZE,
  debug?: DebugLogger
): Promise<ExecuteBookingBatchResult> {
  const progress = getBookingProgress(job);
  if (progress.pending === 0 || job.status === 'completed') {
    return {
      job: finalizeJobStatus(job),
      progress: getBookingProgress(job),
      bookedThisBatch: 0,
      failedThisBatch: 0,
      reconciledThisBatch: 0,
      done: true,
      hint: 'Booking job already finished.',
    };
  }

  const pendingItems = job.items.filter(i => i.status === 'pending');
  if (pendingItems.length === 0) {
    const finalized = finalizeJobStatus(job);
    return {
      job: finalized,
      progress: getBookingProgress(finalized),
      bookedThisBatch: 0,
      failedThisBatch: 0,
      reconciledThisBatch: 0,
      done: true,
      hint: 'No pending items.',
    };
  }

  const rangeStart = pendingItems.reduce(
    (min, i) => (i.start < min ? i.start : min),
    pendingItems[0].start
  );
  const rangeEnd = pendingItems.reduce(
    (max, i) => (i.end > max ? i.end : max),
    pendingItems[0].end
  );
  const calendarEvents = await listEvents(rangeStart, rangeEnd, undefined, debug, 50);

  const items = [...job.items];
  let bookedThisBatch = 0;
  let failedThisBatch = 0;
  let reconciledThisBatch = 0;
  let processed = 0;

  for (let i = 0; i < items.length && processed < batchSize; i++) {
    if (items[i].status !== 'pending') continue;

    let item = items[i];
    processed++;

    const reconciled = await reconcilePendingItem(item, calendarEvents);
    if (reconciled.action === 'already_booked') {
      items[i] = reconciled.item;
      reconciledThisBatch++;
      bookedThisBatch++;
      debug?.log({
        type: 'booking_batch_item',
        day: item.day,
        action: 'reconciled_already_booked',
        eventId: reconciled.item.eventId,
      });
      continue;
    }

    try {
      const free = await isSlotFree(item.start, item.end);
      debug?.log({
        type: 'booking_batch_item',
        day: item.day,
        action: free ? 'create' : 'failed_busy',
        isSlotFree: free,
      });

      if (!free) {
        const retry = findMatchingEvent(item, calendarEvents);
        if (retry?.id) {
          items[i] = {
            ...item,
            status: 'booked',
            eventId: retry.id,
          };
          reconciledThisBatch++;
          bookedThisBatch++;
          debug?.log({
            type: 'booking_batch_item',
            day: item.day,
            action: 'reconciled_after_busy',
            eventId: retry.id,
          });
          continue;
        }

        items[i] = {
          ...item,
          status: 'failed',
          error: 'Time slot is no longer available.',
        };
        failedThisBatch++;
        continue;
      }

      const event = await createEvent(item.summary, item.start, item.end);
      items[i] = {
        ...item,
        status: 'booked',
        eventId: event.id,
      };
      bookedThisBatch++;
      debug?.log({
        type: 'booking_batch_item',
        day: item.day,
        action: 'booked',
        eventId: event.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create event';
      items[i] = {
        ...item,
        status: 'failed',
        error: message,
      };
      failedThisBatch++;
      debug?.log({
        type: 'booking_batch_item',
        day: item.day,
        action: 'error',
        error: message,
      });
    }
  }

  let updatedJob: BookingJob = {
    ...job,
    items,
    status: 'in_progress',
    updatedAt: new Date().toISOString(),
  };
  updatedJob = finalizeJobStatus(updatedJob);

  const finalProgress = getBookingProgress(updatedJob);
  debug?.log({
    type: 'booking_batch_done',
    booked: finalProgress.booked,
    failed: finalProgress.failed,
    pending: finalProgress.pending,
    done: finalProgress.pending === 0,
  });

  return {
    job: updatedJob,
    progress: finalProgress,
    bookedThisBatch,
    failedThisBatch,
    reconciledThisBatch,
    done: finalProgress.pending === 0,
    hint: finalProgress.pending === 0
      ? 'All days processed. Do not call init_booking_job or execute_booking_batch again.'
      : 'More days pending — client SSE will continue booking.',
  };
}

export async function runBookingJobToCompletion(
  job: BookingJob,
  batchSize: number = DEFAULT_BATCH_SIZE,
  onBatch?: (progress: BookingProgressSnapshot) => void,
  debug?: DebugLogger,
  sessionId?: string
): Promise<{ job: BookingJob; progress: BookingProgressSnapshot; blocked?: boolean }> {
  const progress0 = getBookingProgress(job);
  if (progress0.pending === 0 || job.status === 'completed') {
    const finalized = finalizeJobStatus(job);
    return { job: finalized, progress: getBookingProgress(finalized) };
  }

  if (job.sseInProgress) {
    debug?.log({
      type: 'booking_sse_end',
      sessionId: sessionId ?? '',
      booked: progress0.booked,
      failed: progress0.failed,
      blocked: true,
    });
    return { job, progress: progress0, blocked: true };
  }

  debug?.log({
    type: 'booking_sse_start',
    sessionId: sessionId ?? '',
    jobId: job.id,
    pending: progress0.pending,
  });

  let current: BookingJob = { ...job, sseInProgress: true };
  let progress = getBookingProgress(current);

  while (progress.pending > 0) {
    const result = await executeBookingBatch(current, batchSize, debug);
    current = result.job;
    progress = result.progress;
    onBatch?.(progress);
  }

  current = { ...finalizeJobStatus(current), sseInProgress: false };
  const finalProgress = getBookingProgress(current);
  debug?.log({
    type: 'booking_sse_end',
    sessionId: sessionId ?? '',
    booked: finalProgress.booked,
    failed: finalProgress.failed,
  });
  return { job: current, progress: finalProgress };
}
