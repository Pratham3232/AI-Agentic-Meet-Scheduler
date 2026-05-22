import {
  updateEventCache,
  getCachedEventsForRange,
  invalidateEventCache,
  findCachedEventById,
} from '@/lib/agent/event-cache';
import type { CalendarEvent, ConversationState } from '@/types';

function testState(): ConversationState {
  return {
    sessionId: 'sess-1',
    bookingJob: null,
    cancelJob: null,
    lastBulkCancelTarget: null,
    cancelPlanConfirmed: false,
    confirmedCancelSummary: null,
    lastMultiDayPlan: null,
    bookingPlanConfirmed: false,
    confirmedPlanSummary: null,
    cachedCalendar: null,
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
  };
}

describe('event-cache', () => {
  const tz = 'UTC';
  let state = testState();

  const events: CalendarEvent[] = [
    {
      id: 'evt-1',
      summary: 'Standup',
      start: { dateTime: '2026-06-02T16:00:00Z' },
      end: { dateTime: '2026-06-02T16:30:00Z' },
    },
  ];

  test('updateEventCache stores events and range', () => {
    state = updateEventCache(state, '2026-06-01T00:00:00Z', '2026-06-03T00:00:00Z', events, tz);
    expect(state.cachedCalendar?.events).toHaveLength(1);
    expect(findCachedEventById(state, 'evt-1')?.summary).toBe('Standup');
  });

  test('getCachedEventsForRange returns subset when query inside cache', () => {
    const rows = getCachedEventsForRange(
      state,
      '2026-06-02T00:00:00Z',
      '2026-06-03T00:00:00Z'
    );
    expect(rows).toHaveLength(1);
    expect(rows![0].id).toBe('evt-1');
  });

  test('invalidateEventCache clears cache and bumps version', () => {
    state = invalidateEventCache(state);
    expect(state.cachedCalendar).toBeNull();
    expect(state.calendarVersion).toBe(1);
  });
});
