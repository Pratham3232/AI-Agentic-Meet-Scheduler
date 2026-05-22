import {
  updateSlot,
  addMessage,
  hasAllRequiredSlots,
  getNextMissingSlot,
  resetSlots,
  setBookingJob,
  getActiveBookingJob,
} from '@/lib/agent/state';
import { ConversationState, BookingJob } from '@/types';

describe('Agent State Management', () => {
  const initialState: ConversationState = {
    sessionId: 'test-session',
    bookingJob: null,
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

  test('updateSlot updates specific slot', () => {
    const updated = updateSlot(initialState, 'duration', 30);
    expect(updated.slots.duration).toBe(30);
    expect(updated.slots.day).toBeNull();
  });

  test('addMessage adds to history and increments turn count', () => {
    const updated = addMessage(initialState, 'user', 'Hello');
    expect(updated.conversationHistory).toHaveLength(1);
    expect(updated.conversationHistory[0].content).toBe('Hello');
    expect(updated.turnCount).toBe(1);
  });

  test('hasAllRequiredSlots returns false when slots missing', () => {
    expect(hasAllRequiredSlots(initialState)).toBe(false);
  });

  test('hasAllRequiredSlots returns true when all slots filled', () => {
    const filledState: ConversationState = {
      ...initialState,
      slots: {
        duration: 30,
        day: '2024-01-15',
        timeWindow: 'morning',
        preferredStart: null,
        preferredEnd: null,
        attendees: [],
      },
    };
    expect(hasAllRequiredSlots(filledState)).toBe(true);
  });

  test('getNextMissingSlot returns duration first', () => {
    expect(getNextMissingSlot(initialState)).toBe('duration');
  });

  test('getNextMissingSlot returns day after duration filled', () => {
    const state = updateSlot(initialState, 'duration', 30);
    expect(getNextMissingSlot(state)).toBe('day');
  });

  test('setBookingJob stores job on state', () => {
    const job: BookingJob = {
      id: 'job-1',
      status: 'in_progress',
      updatedAt: new Date().toISOString(),
      items: [
        {
          day: '2026-05-20',
          start: '2026-05-20T14:00:00Z',
          end: '2026-05-20T15:00:00Z',
          summary: 'Meeting',
          status: 'pending',
        },
      ],
    };
    const updated = setBookingJob(initialState, job);
    expect(updated.bookingJob?.id).toBe('job-1');
    expect(getActiveBookingJob(updated)?.items).toHaveLength(1);
  });

  test('setBookingJob clears job when null', () => {
    const withJob = setBookingJob(initialState, {
      id: 'x',
      status: 'completed',
      updatedAt: '',
      items: [],
    });
    const cleared = setBookingJob(withJob, null);
    expect(cleared.bookingJob).toBeNull();
  });

  test('resetSlots clears all slot data', () => {
    const filledState: ConversationState = {
      ...initialState,
      slots: {
        duration: 30,
        day: '2024-01-15',
        timeWindow: 'morning',
        preferredStart: null,
        preferredEnd: null,
        attendees: ['test@example.com'],
      },
      calendarResults: [{ start: '2024-01-15T09:00:00Z', end: '2024-01-15T09:30:00Z' }],
      awaitingConfirmation: true,
      bookingJob: {
        id: 'job-reset',
        status: 'in_progress',
        updatedAt: '',
        items: [],
      },
    };

    const reset = resetSlots(filledState);
    expect(reset.bookingJob).toBeNull();
    expect(reset.slots.duration).toBeNull();
    expect(reset.slots.day).toBeNull();
    expect(reset.slots.timeWindow).toBeNull();
    expect(reset.slots.attendees).toEqual([]);
    expect(reset.calendarResults).toEqual([]);
    expect(reset.awaitingConfirmation).toBe(false);
  });
});
