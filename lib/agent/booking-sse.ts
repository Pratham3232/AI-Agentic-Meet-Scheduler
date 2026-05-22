import type { BookingJob } from '@/types';
import {
  SSE_STALE_LOCK_MS,
  isStaleSseLock as isStaleSseLockGeneric,
  clearSseLock as clearSseLockGeneric,
} from '@/lib/agent/job-sse';

export { SSE_STALE_LOCK_MS };

export function isStaleSseLock(job: BookingJob, now?: Date): boolean {
  return isStaleSseLockGeneric(job, now);
}

export function clearSseLock(job: BookingJob): BookingJob {
  return clearSseLockGeneric(job);
}
