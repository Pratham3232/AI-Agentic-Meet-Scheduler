/** Shared SSE in-progress lock helpers for booking and cancel jobs. */

export const SSE_STALE_LOCK_MS = 10 * 60 * 1000;

export interface SseLockableJob {
  sseInProgress?: boolean;
  updatedAt: string;
}

export function isStaleSseLock(job: SseLockableJob, now: Date = new Date()): boolean {
  if (!job.sseInProgress) return false;
  const updated = new Date(job.updatedAt).getTime();
  if (Number.isNaN(updated)) return true;
  return now.getTime() - updated > SSE_STALE_LOCK_MS;
}

export function clearSseLock<T extends SseLockableJob>(job: T): T {
  return {
    ...job,
    sseInProgress: false,
    updatedAt: new Date().toISOString(),
  };
}
