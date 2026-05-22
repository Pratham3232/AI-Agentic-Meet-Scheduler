import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getCancelProgress } from '@/lib/agent/cancel-progress';
import { deleteEvent } from '@/lib/calendar/events';
import { formatTimeSlot } from '@/lib/calendar/utils';
import type { DebugLogger } from '@/lib/debug';
import type {
  CachedCalendarSnapshot,
  CancelJob,
  CancelJobItem,
  CancelProgressSnapshot,
  ConversationState,
} from '@/types';

export interface InitCancelJobResult {
  job: CancelJob;
  jobId: string;
  total: number;
  hint: string;
}

export interface InitCancelJobBlocked {
  error: 'job_already_done';
  message: string;
  progress: CancelProgressSnapshot;
}

export interface ExecuteCancelBatchResult {
  job: CancelJob;
  progress: CancelProgressSnapshot;
  cancelledThisBatch: number;
  failedThisBatch: number;
  done: boolean;
  hint: string;
  failedDetails: Array<{ eventId: string; reason: string }>;
}

const DEFAULT_BATCH_SIZE = 5;

export function eventIdsFingerprint(eventIds: string[]): string {
  const sorted = [...eventIds].sort();
  return createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 16);
}

export function resolveCancelEventIds(
  eventIds: string[],
  state: ConversationState
): string[] {
  if (eventIds.length >= 2) return eventIds;
  const target = state.lastBulkCancelTarget;
  if (target?.eventIds?.length) return target.eventIds;
  const cache = state.cachedCalendar;
  if (cache?.events?.length && eventIds.length <= 1) {
    return cache.events.map(e => e.id);
  }
  return eventIds;
}

function buildItemsFromIds(
  eventIds: string[],
  state: ConversationState,
  timezone: string
): CancelJobItem[] {
  const cacheMap = new Map(
    (state.cachedCalendar?.events ?? []).map(e => [e.id, e])
  );

  return eventIds.map(id => {
    const cached = cacheMap.get(id);
    if (cached) {
      return {
        eventId: id,
        summary: cached.summary,
        start: cached.start,
        end: cached.end,
        status: 'pending' as const,
        display: cached.display,
      };
    }
    return {
      eventId: id,
      summary: '(event)',
      start: '',
      end: '',
      status: 'pending' as const,
      display: id,
    };
  });
}

export { getCancelProgress } from '@/lib/agent/cancel-progress';

function finalizeCancelJobStatus(job: CancelJob): CancelJob {
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

export async function evaluateInitCancelBlock(
  eventIds: string[],
  existingJob?: CancelJob | null,
  force?: boolean
): Promise<InitCancelJobBlocked | null> {
  if (force || eventIds.length === 0) return null;

  if (existingJob) {
    const progress = getCancelProgress(existingJob);
    if (existingJob.status === 'completed') {
      return {
        error: 'job_already_done',
        message: `All ${progress.total} event(s) already cancelled.`,
        progress,
      };
    }
    if (progress.cancelled > 0 && progress.pending === 0) {
      return {
        error: 'job_already_done',
        message: `All ${progress.cancelled} event(s) already processed.`,
        progress,
      };
    }
    const fp = eventIdsFingerprint(eventIds);
    if (
      existingJob.eventIdsFingerprint === fp &&
      existingJob.status === 'in_progress'
    ) {
      return {
        error: 'job_already_done',
        message: 'Cancel job already in progress for these events.',
        progress,
      };
    }
  }

  return null;
}

export async function initCancelJob(
  eventIds: string[],
  state: ConversationState,
  timezone: string = 'UTC',
  existingJob?: CancelJob | null,
  force?: boolean
): Promise<InitCancelJobResult | InitCancelJobBlocked> {
  const resolved = resolveCancelEventIds(eventIds, state);
  const blocked = await evaluateInitCancelBlock(resolved, existingJob, force);
  if (blocked) return blocked;

  const items = buildItemsFromIds(resolved, state, timezone);
  const job: CancelJob = {
    id: uuidv4(),
    status: items.length > 0 ? 'in_progress' : 'completed',
    items,
    updatedAt: new Date().toISOString(),
    eventIdsFingerprint: eventIdsFingerprint(resolved),
    sseInProgress: false,
  };

  return {
    job,
    jobId: job.id,
    total: items.length,
    hint:
      items.length === 0
        ? 'No events to cancel.'
        : 'Cancel job initialized. Client will delete remaining events via progress UI. Do not call delete_event for each event.',
  };
}

export async function executeCancelBatch(
  job: CancelJob,
  batchSize: number = DEFAULT_BATCH_SIZE,
  debug?: DebugLogger
): Promise<ExecuteCancelBatchResult> {
  const progress = getCancelProgress(job);
  if (progress.pending === 0 || job.status === 'completed') {
    const finalized = finalizeCancelJobStatus(job);
    return {
      job: finalized,
      progress: getCancelProgress(finalized),
      cancelledThisBatch: 0,
      failedThisBatch: 0,
      done: true,
      hint: 'Cancel job already finished.',
      failedDetails: [],
    };
  }

  const items = [...job.items];
  let cancelledThisBatch = 0;
  let failedThisBatch = 0;
  let processed = 0;
  const failedDetails: Array<{ eventId: string; reason: string }> = [];

  for (let i = 0; i < items.length && processed < batchSize; i++) {
    if (items[i].status !== 'pending') continue;
    processed++;
    const item = items[i];
    try {
      await deleteEvent(item.eventId);
      items[i] = { ...item, status: 'cancelled', error: undefined };
      cancelledThisBatch++;
      debug?.log({
        type: 'tool_result',
        tool: 'cancel_batch_item',
        summary: `cancelled ${item.eventId}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const gone = /not found|404|deleted/i.test(message);
      items[i] = {
        ...item,
        status: gone ? 'cancelled' : 'failed',
        error: gone ? undefined : message,
      };
      if (gone) cancelledThisBatch++;
      else {
        failedThisBatch++;
        failedDetails.push({ eventId: item.eventId, reason: message });
      }
    }
  }

  let updatedJob: CancelJob = {
    ...job,
    items,
    status: 'in_progress',
    updatedAt: new Date().toISOString(),
  };
  updatedJob = finalizeCancelJobStatus(updatedJob);
  const finalProgress = getCancelProgress(updatedJob);

  return {
    job: updatedJob,
    progress: finalProgress,
    cancelledThisBatch,
    failedThisBatch,
    done: finalProgress.pending === 0,
    hint:
      finalProgress.pending === 0
        ? `All ${finalProgress.cancelled} event(s) cancelled. Do not call init_cancel_job or delete_event again. Tell user: "All events cancelled."`
        : `Cancellation started — ${finalProgress.cancelled} cancelled so far, ${finalProgress.pending} remaining will complete automatically via the progress bar. Tell user: "Cancellation started — the rest will complete automatically."`,
    failedDetails,
  };
}

export async function runCancelJobToCompletion(
  job: CancelJob,
  batchSize: number = DEFAULT_BATCH_SIZE,
  onBatch?: (progress: CancelProgressSnapshot) => void,
  debug?: DebugLogger,
  sessionId?: string
): Promise<{ job: CancelJob; progress: CancelProgressSnapshot; blocked?: boolean }> {
  const progress0 = getCancelProgress(job);
  if (progress0.pending === 0 || job.status === 'completed') {
    const finalized = finalizeCancelJobStatus(job);
    return { job: finalized, progress: getCancelProgress(finalized) };
  }

  let current: CancelJob = { ...job, sseInProgress: true };
  let progress = getCancelProgress(current);

  while (progress.pending > 0) {
    const result = await executeCancelBatch(current, batchSize, debug);
    current = result.job;
    progress = result.progress;
    onBatch?.(progress);
  }

  current = { ...finalizeCancelJobStatus(current), sseInProgress: false };
  return { job: current, progress: getCancelProgress(current) };
}

export function setLastBulkCancelTarget(
  state: ConversationState,
  timeMin: string,
  timeMax: string,
  events: CachedCalendarSnapshot['events']
): ConversationState {
  return {
    ...state,
    lastBulkCancelTarget: {
      timeMin,
      timeMax,
      eventIds: events.map(e => e.id),
      count: events.length,
      summary: `${events.length} event(s) from ${timeMin.slice(0, 10)} to ${timeMax.slice(0, 10)}`,
    },
  };
}
