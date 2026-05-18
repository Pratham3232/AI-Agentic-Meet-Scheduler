import {
  updateSlot,
  addMessage,
  hasAllRequiredSlots,
  getNextMissingSlot,
  resetSlots,
} from '@/lib/agent/state';
import { ConversationState } from '@/types';

describe('Agent State Management', () => {
  const initialState: ConversationState = {
    sessionId: 'test-session',
    slots: {
      duration: null,
      day: null,
      timeWindow: null,
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

  test('resetSlots clears all slot data', () => {
    const filledState: ConversationState = {
      ...initialState,
      slots: {
        duration: 30,
        day: '2024-01-15',
        timeWindow: 'morning',
        attendees: ['test@example.com'],
      },
      calendarResults: [{ start: '2024-01-15T09:00:00Z', end: '2024-01-15T09:30:00Z' }],
      awaitingConfirmation: true,
    };

    const reset = resetSlots(filledState);
    expect(reset.slots.duration).toBeNull();
    expect(reset.slots.day).toBeNull();
    expect(reset.slots.timeWindow).toBeNull();
    expect(reset.slots.attendees).toEqual([]);
    expect(reset.calendarResults).toEqual([]);
    expect(reset.awaitingConfirmation).toBe(false);
  });
});
