import { extractAndUpdateSlots, extractBookingDays } from '@/lib/agent/slot-filler';
import { DebugLogger } from '@/lib/debug';
import { ConversationState } from '@/types';
import { format, addDays } from 'date-fns';

const TODAY = new Date('2026-05-18T10:00:00Z'); // Monday
const debug = () => new DebugLogger();

const blank: ConversationState = {
  sessionId: 'test',
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

describe('Duration extraction', () => {
  test('30 minutes', () => {
    expect(extractAndUpdateSlots('I need 30 minutes', blank, debug(), TODAY).slots.duration).toBe(30);
  });
  test('2 hours', () => {
    expect(extractAndUpdateSlots('I need 2 hours', blank, debug(), TODAY).slots.duration).toBe(120);
  });
  test('1 hr', () => {
    expect(extractAndUpdateSlots('1 hr meeting', blank, debug(), TODAY).slots.duration).toBe(60);
  });
  test('half hour', () => {
    expect(extractAndUpdateSlots('half an hour', blank, debug(), TODAY).slots.duration).toBe(30);
  });
  test('1h30m', () => {
    expect(extractAndUpdateSlots('1 hour 30 minutes', blank, debug(), TODAY).slots.duration).toBe(90);
  });
});

describe('Day extraction', () => {
  test('today', () => {
    expect(extractAndUpdateSlots('today', blank, debug(), TODAY).slots.day).toBe('2026-05-18');
  });
  test('tomorrow', () => {
    expect(extractAndUpdateSlots('tomorrow', blank, debug(), TODAY).slots.day).toBe('2026-05-19');
  });
  test('next Monday (today is Monday → next Monday = May 25)', () => {
    expect(extractAndUpdateSlots('next monday', blank, debug(), TODAY).slots.day).toBe('2026-05-25');
  });
  test('Wednesday (bare — next upcoming Wednesday from Monday = May 20)', () => {
    expect(extractAndUpdateSlots('wednesday', blank, debug(), TODAY).slots.day).toBe('2026-05-20');
  });
  test('ISO date literal', () => {
    expect(extractAndUpdateSlots('on 2026-06-01', blank, debug(), TODAY).slots.day).toBe('2026-06-01');
  });
});

describe('Time window extraction', () => {
  test('morning', () => {
    expect(extractAndUpdateSlots('morning please', blank, debug(), TODAY).slots.timeWindow).toBe('morning');
  });
  test('afternoon', () => {
    expect(extractAndUpdateSlots('afternoon works', blank, debug(), TODAY).slots.timeWindow).toBe('afternoon');
  });
  test('anytime', () => {
    expect(extractAndUpdateSlots("I'm flexible", blank, debug(), TODAY).slots.timeWindow).toBe('anytime');
  });
});

describe('Update detection and stale clearing', () => {
  test('changes duration and clears stale results', () => {
    const stateWith30 = {
      ...blank,
      slots: { ...blank.slots, duration: 30 },
      calendarResults: [{ start: 'x', end: 'y' }],
      lastSearchParams: { duration: 30, day: '2026-05-19', timeWindow: 'morning' },
    };
    const result = extractAndUpdateSlots('actually make it 1 hour', stateWith30, debug(), TODAY);
    expect(result.slots.duration).toBe(60);
    expect(result.calendarResults).toHaveLength(0);
    expect(result.lastSearchParams).toBeNull();
  });
});

describe('Attendee extraction', () => {
  test('email in message', () => {
    const result = extractAndUpdateSlots('include john@example.com', blank, debug(), TODAY);
    expect(result.slots.attendees).toContain('john@example.com');
  });
});

describe('Combined single message', () => {
  test('1 hour tomorrow morning with email', () => {
    const result = extractAndUpdateSlots(
      'I need 1 hour tomorrow morning with jane@company.io',
      blank, debug(), TODAY
    );
    expect(result.slots.duration).toBe(60);
    expect(result.slots.day).toBe('2026-05-19');
    expect(result.slots.timeWindow).toBe('morning');
    expect(result.slots.attendees).toContain('jane@company.io');
  });
});

describe('Preferred time extraction', () => {
  test('at 10 AM', () => {
    const result = extractAndUpdateSlots('book at 10 AM tomorrow', blank, debug(), TODAY);
    expect(result.slots.preferredStart).toBe('10:00');
  });

  test('9 to 11 am range', () => {
    const result = extractAndUpdateSlots('book 9 to 11 am on friday', blank, debug(), TODAY);
    expect(result.slots.preferredStart).toBe('09:00');
    expect(result.slots.preferredEnd).toBe('11:00');
  });
});

describe('extractBookingDays', () => {
  test('next 3 days', () => {
    const days = extractBookingDays('book for the next 3 days at 10', TODAY);
    expect(days).toHaveLength(3);
  });
});
