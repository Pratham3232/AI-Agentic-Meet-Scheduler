import {
  shouldApplyBookingProgress,
  upsertBookingProgressMessage,
  isNewBookingJob,
} from '@/lib/client/booking-progress-ui';
import type { BookingProgressSnapshot } from '@/types';

function snap(partial: Partial<BookingProgressSnapshot>): BookingProgressSnapshot {
  return {
    jobId: 'job-1',
    status: 'in_progress',
    total: 10,
    booked: 0,
    failed: 0,
    pending: 10,
    skipped: 0,
    percent: 0,
    items: [],
    ...partial,
  };
}

describe('booking-progress-ui', () => {
  test('shouldApplyBookingProgress rejects different jobId while in progress', () => {
    const current = snap({ jobId: 'job-a', pending: 3 });
    const next = snap({ jobId: 'job-b', pending: 10 });
    expect(shouldApplyBookingProgress(current, next)).toBe(false);
  });

  test('shouldApplyBookingProgress accepts new jobId after previous completed', () => {
    const current = snap({
      jobId: 'job-a',
      status: 'completed',
      booked: 10,
      pending: 0,
      percent: 100,
    });
    const next = snap({ jobId: 'job-b', pending: 5 });
    expect(isNewBookingJob(current, next)).toBe(true);
    expect(shouldApplyBookingProgress(current, next)).toBe(true);
  });

  test('shouldApplyBookingProgress rejects downgrade after complete', () => {
    const current = snap({
      status: 'completed',
      booked: 10,
      pending: 0,
      percent: 100,
    });
    const next = snap({ status: 'in_progress', pending: 5, percent: 50 });
    expect(shouldApplyBookingProgress(current, next)).toBe(false);
  });

  test('upsertBookingProgressMessage keeps single progress card', () => {
    const first = snap({ booked: 2, pending: 8, percent: 20 });
    const second = snap({ booked: 5, pending: 5, percent: 50 });
    const once = upsertBookingProgressMessage([], first);
    const twice = upsertBookingProgressMessage(once, second);
    const withProgress = twice.filter(m => m.bookingProgress);
    expect(withProgress).toHaveLength(1);
    expect(withProgress[0].bookingProgress?.booked).toBe(5);
  });

  test('upsertBookingProgressMessage preserves assistant transcript on SSE update', () => {
    const progress = snap({ booked: 2, pending: 3, percent: 40 });
    const messages = [
      { role: 'user', content: 'book yoga' },
      {
        role: 'assistant',
        content: 'Confirming 3 sessions.',
        bookingProgress: snap({ booked: 0, pending: 5, percent: 0 }),
      },
    ];
    const updated = upsertBookingProgressMessage(messages, progress);
    expect(updated[1].content).toBe('Confirming 3 sessions.');
    expect(updated[1].bookingProgress?.booked).toBe(2);
  });

  test('attachToLastAssistant merges progress into latest assistant bubble', () => {
    const progress = snap({ booked: 0, pending: 3 });
    const messages = [
      { role: 'user', content: 'book yoga' },
      { role: 'assistant', content: 'Confirming 3 sessions.' },
    ];
    const updated = upsertBookingProgressMessage(messages, progress, {
      attachToLastAssistant: true,
    });
    expect(updated).toHaveLength(2);
    expect(updated[1].bookingProgress?.jobId).toBe('job-1');
    expect(updated.filter(m => m.bookingProgress)).toHaveLength(1);
  });
});
