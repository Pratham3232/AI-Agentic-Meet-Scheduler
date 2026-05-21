import { v4 as uuidv4 } from 'uuid';
import { createEvent } from '@/lib/calendar/events';
import { isSlotFree } from '@/lib/calendar/slot-search';
import { formatTimeSlot } from '@/lib/calendar/utils';
import type {
  BookingJob,
  BookingJobItem,
  BookingProgressSnapshot,
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

export interface ExecuteBookingBatchResult {
  job: BookingJob;
  progress: BookingProgressSnapshot;
  bookedThisBatch: number;
  failedThisBatch: number;
  done: boolean;
  hint: string;
}

const DEFAULT_BATCH_SIZE = 5;

export function initBookingJob(
  entries: BookingJobEntryInput[],
  timezone: string = 'UTC'
): InitBookingJobResult {
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
  };

  return {
    job,
    jobId: job.id,
    total: items.length,
    hint:
      items.length === 0
        ? 'No entries to book.'
        : 'Job initialized. Call execute_booking_batch once, then the client will auto-continue via /api/booking/run.',
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
  };
}

export async function executeBookingBatch(
  job: BookingJob,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<ExecuteBookingBatchResult> {
  if (job.status === 'completed' || job.status === 'failed') {
    const progress = getBookingProgress(job);
    return {
      job,
      progress,
      bookedThisBatch: 0,
      failedThisBatch: 0,
      done: true,
      hint: 'Booking job already finished.',
    };
  }

  const items = [...job.items];
  let bookedThisBatch = 0;
  let failedThisBatch = 0;
  let processed = 0;

  for (let i = 0; i < items.length && processed < batchSize; i++) {
    if (items[i].status !== 'pending') continue;

    const item = items[i];
    processed++;

    try {
      const free = await isSlotFree(item.start, item.end);
      if (!free) {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create event';
      items[i] = {
        ...item,
        status: 'failed',
        error: message,
      };
      failedThisBatch++;
    }
  }

  let updatedJob: BookingJob = {
    ...job,
    items,
    status: 'in_progress',
    updatedAt: new Date().toISOString(),
  };
  updatedJob = finalizeJobStatus(updatedJob);

  const progress = getBookingProgress(updatedJob);
  const done = progress.pending === 0;

  return {
    job: updatedJob,
    progress,
    bookedThisBatch,
    failedThisBatch,
    done,
    hint: done
      ? 'All days processed.'
      : 'More days pending — call execute_booking_batch again or use /api/booking/run for live progress.',
  };
}

export async function runBookingJobToCompletion(
  job: BookingJob,
  batchSize: number = DEFAULT_BATCH_SIZE,
  onBatch?: (progress: BookingProgressSnapshot) => void
): Promise<{ job: BookingJob; progress: BookingProgressSnapshot }> {
  let current = job;
  let progress = getBookingProgress(current);

  while (progress.pending > 0) {
    const result = await executeBookingBatch(current, batchSize);
    current = result.job;
    progress = result.progress;
    onBatch?.(progress);
  }

  return { job: current, progress };
}
