import {
  findBookedJobItemForSlot,
  isBookingJobFinished,
  tryReconcileCreateEventWithBookingJob,
  buildBookingJobPromptBlock,
} from '@/lib/agent/booking-context';
import type { ConversationState } from '@/types';

function stateWithJob(
  overrides: Partial<ConversationState['bookingJob']> = {}
): ConversationState {
  return {
    sessionId: 's1',
    cancelJob: null,
    lastBulkCancelTarget: null,
    cancelPlanConfirmed: false,
    confirmedCancelSummary: null,
    bookingJob: {
      id: 'job-1',
      status: 'completed',
      updatedAt: new Date().toISOString(),
      items: [
        {
          day: '2026-05-25',
          start: '2026-05-25T22:00:00.000Z',
          end: '2026-05-25T22:15:00.000Z',
          summary: 'Meeting',
          status: 'booked',
          eventId: 'ev-1',
          display: 'Monday, May 25 at 10:00 PM – 10:15 PM',
        },
      ],
      ...overrides,
    },
    lastMultiDayPlan: null,
    bookingPlanConfirmed: true,
    confirmedPlanSummary: '5 dinners Mon–Fri 10 PM',
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

describe('booking-context', () => {
  test('isBookingJobFinished when all booked', () => {
    const s = stateWithJob();
    expect(isBookingJobFinished(s.bookingJob)).toBe(true);
  });

  test('findBookedJobItemForSlot matches exact times', () => {
    const s = stateWithJob();
    const item = findBookedJobItemForSlot(
      s,
      '2026-05-25T22:00:00.000Z',
      '2026-05-25T22:15:00.000Z',
      'Meeting'
    );
    expect(item?.eventId).toBe('ev-1');
  });

  test('tryReconcileCreateEventWithBookingJob returns alreadyBooked', () => {
    const s = stateWithJob();
    const r = tryReconcileCreateEventWithBookingJob(
      s,
      '2026-05-25T22:00:00.000Z',
      '2026-05-25T22:15:00.000Z',
      'Meeting'
    );
    expect(r?.alreadyBooked).toBe(true);
    expect(r?.success).toBe(true);
  });

  test('buildBookingJobPromptBlock forbids re-book', () => {
    const block = buildBookingJobPromptBlock(stateWithJob());
    expect(block).toContain('COMPLETE');
    expect(block).toContain('create_event');
    expect(block).toContain('5 dinners');
  });
});
