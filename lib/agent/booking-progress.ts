import type { BookingJob, BookingProgressSnapshot } from '@/types';

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
