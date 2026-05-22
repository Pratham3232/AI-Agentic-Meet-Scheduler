import type { BookingJob } from '@/types';

/** If an SSE run crashed, release the lock after this age. */
export const SSE_STALE_LOCK_MS = 10 * 60 * 1000;

export function isStaleSseLock(job: BookingJob, now: Date = new Date()): boolean {
  if (!job.sseInProgress) return false;
  const updated = new Date(job.updatedAt).getTime();
  if (Number.isNaN(updated)) return true;
  return now.getTime() - updated > SSE_STALE_LOCK_MS;
}

export function clearSseLock(job: BookingJob): BookingJob {
  return {
    ...job,
    sseInProgress: false,
    updatedAt: new Date().toISOString(),
  };
}
