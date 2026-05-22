import { isStaleSseLock, clearSseLock, SSE_STALE_LOCK_MS } from '@/lib/agent/booking-sse';
import type { BookingJob } from '@/types';

function job(overrides: Partial<BookingJob> = {}): BookingJob {
  return {
    id: 'j1',
    status: 'in_progress',
    items: [],
    updatedAt: new Date().toISOString(),
    sseInProgress: true,
    ...overrides,
  };
}

describe('booking-sse', () => {
  test('isStaleSseLock false for fresh lock', () => {
    expect(isStaleSseLock(job())).toBe(false);
  });

  test('isStaleSseLock true when updatedAt is older than TTL', () => {
    const old = new Date(Date.now() - SSE_STALE_LOCK_MS - 1000).toISOString();
    expect(isStaleSseLock(job({ updatedAt: old }))).toBe(true);
  });

  test('clearSseLock removes flag', () => {
    const cleared = clearSseLock(job());
    expect(cleared.sseInProgress).toBe(false);
  });
});
