import {
  initCancelJob,
  executeCancelBatch,
  runCancelJobToCompletion,
  evaluateInitCancelBlock,
  resolveCancelEventIds,
  eventIdsFingerprint,
} from '@/lib/agent/cancel-executor';
import type { ConversationState } from '@/types';

jest.mock('@/lib/calendar/events', () => ({
  deleteEvent: jest.fn().mockResolvedValue(undefined),
}));

import { deleteEvent } from '@/lib/calendar/events';

function baseState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    sessionId: 's1',
    bookingJob: null,
    cancelJob: null,
    lastBulkCancelTarget: {
      timeMin: '2026-05-01T00:00:00Z',
      timeMax: '2026-05-31T23:59:59Z',
      eventIds: ['e1', 'e2', 'e3'],
      count: 3,
      summary: '3 events in May',
    },
    cancelPlanConfirmed: false,
    confirmedCancelSummary: null,
    lastMultiDayPlan: null,
    bookingPlanConfirmed: false,
    confirmedPlanSummary: null,
    cachedCalendar: {
      timeMin: '2026-05-01T00:00:00Z',
      timeMax: '2026-05-31T23:59:59Z',
      fetchedAt: new Date().toISOString(),
      events: [
        {
          id: 'e1',
          summary: 'A',
          start: '2026-05-01T10:00:00Z',
          end: '2026-05-01T11:00:00Z',
          display: 'May 1',
        },
        {
          id: 'e2',
          summary: 'B',
          start: '2026-05-02T10:00:00Z',
          end: '2026-05-02T11:00:00Z',
          display: 'May 2',
        },
        {
          id: 'e3',
          summary: 'C',
          start: '2026-05-03T10:00:00Z',
          end: '2026-05-03T11:00:00Z',
          display: 'May 3',
        },
      ],
    },
    calendarVersion: 0,
    pendingReschedule: null,
    lastRescheduledEvent: null,
    slots: {
      duration: null,
      day: null,
      timeWindow: null,
      preferredStart: null,
      preferredEnd: null,
      attendees: [],
    },
    calendarResults: [],
    awaitingConfirmation: false,
    lastSearchParams: null,
    turnCount: 0,
    conversationHistory: [],
    ...overrides,
  };
}

describe('cancel-executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resolveCancelEventIds keeps explicit single id', () => {
    const ids = resolveCancelEventIds(['e1'], baseState());
    expect(ids).toEqual(['e1']);
  });

  test('resolveCancelEventIds expands from lastBulkCancelTarget when empty', () => {
    const ids = resolveCancelEventIds([], baseState());
    expect(ids).toEqual(['e1', 'e2', 'e3']);
  });

  test('resolveCancelEventIds expands from cache when empty and no bulk target', () => {
    const ids = resolveCancelEventIds(
      [],
      baseState({ lastBulkCancelTarget: null })
    );
    expect(ids).toEqual(['e1', 'e2', 'e3']);
  });

  test('executeCancelBatch cancels when sseInProgress with fromSseLoop', async () => {
    const init = await initCancelJob(['e1'], baseState(), 'UTC');
    if ('error' in init) throw new Error('unexpected');
    const inSse = {
      ...init.job,
      sseInProgress: true,
      updatedAt: new Date().toISOString(),
    };
    const batch = await executeCancelBatch(inSse, 5, undefined, { fromSseLoop: true });
    expect(batch.cancelledThisBatch).toBe(1);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });

  test('runCancelJobToCompletion cancels when job has sseInProgress', async () => {
    const init = await initCancelJob(['e1', 'e2'], baseState(), 'UTC');
    if ('error' in init) throw new Error('unexpected');
    const inSse = {
      ...init.job,
      sseInProgress: true,
      updatedAt: new Date().toISOString(),
    };
    const { progress } = await runCancelJobToCompletion(inSse, 5);
    expect(progress.pending).toBe(0);
    expect(progress.cancelled).toBe(2);
    expect(deleteEvent).toHaveBeenCalledTimes(2);
  });

  test('initCancelJob creates pending items', async () => {
    const r = await initCancelJob(['e1', 'e2'], baseState(), 'UTC');
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.total).toBe(2);
    expect(r.job.items.every(i => i.status === 'pending')).toBe(true);
  });

  test('executeCancelBatch deletes and marks cancelled', async () => {
    const init = await initCancelJob(['e1', 'e2'], baseState(), 'UTC');
    if ('error' in init) throw new Error('unexpected block');
    const batch = await executeCancelBatch(init.job, 5);
    expect(batch.cancelledThisBatch).toBe(2);
    expect(batch.progress.pending).toBe(0);
    expect(deleteEvent).toHaveBeenCalledTimes(2);
  });

  test('job_already_done blocks re-init when completed', async () => {
    const init = await initCancelJob(['e1'], baseState(), 'UTC');
    if ('error' in init) throw new Error('unexpected');
    const job = {
      ...init.job,
      status: 'completed' as const,
      items: init.job.items.map(i => ({ ...i, status: 'cancelled' as const })),
    };
    const blocked = await evaluateInitCancelBlock(['e1'], job);
    expect(blocked?.error).toBe('job_already_done');
  });

  test('404 on delete counts as cancelled', async () => {
    (deleteEvent as jest.Mock).mockRejectedValueOnce(new Error('404 Not Found'));
    const init = await initCancelJob(['e1'], baseState(), 'UTC');
    if ('error' in init) throw new Error('unexpected');
    const batch = await executeCancelBatch(init.job, 1);
    expect(batch.progress.cancelled).toBe(1);
    expect(batch.progress.failed).toBe(0);
  });

  test('eventIdsFingerprint is stable', () => {
    expect(eventIdsFingerprint(['b', 'a'])).toBe(eventIdsFingerprint(['a', 'b']));
  });
});
