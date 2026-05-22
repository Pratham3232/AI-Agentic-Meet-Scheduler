import type { CancelJob, CancelProgressSnapshot } from '@/types';

export function getCancelProgress(job: CancelJob): CancelProgressSnapshot {
  const total = job.items.length;
  const cancelled = job.items.filter(i => i.status === 'cancelled').length;
  const failed = job.items.filter(i => i.status === 'failed').length;
  const skipped = job.items.filter(i => i.status === 'skipped').length;
  const pending = job.items.filter(i => i.status === 'pending').length;
  const finished = cancelled + failed + skipped;
  const percent = total === 0 ? 100 : Math.round((finished / total) * 100);

  return {
    jobId: job.id,
    status: job.status,
    total,
    cancelled,
    failed,
    pending,
    skipped,
    percent,
    items: job.items,
  };
}
