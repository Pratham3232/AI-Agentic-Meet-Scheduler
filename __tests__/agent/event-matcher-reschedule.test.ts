import { runRescheduleEvent } from '@/lib/agent/event-matcher';
import { getEventById, patchEvent } from '@/lib/calendar/events';
import { isSlotFree } from '@/lib/calendar/slot-search';
import type { ConversationState } from '@/types';

jest.mock('@/lib/calendar/events', () => ({
  getEventById: jest.fn(),
  patchEvent: jest.fn(),
  listEvents: jest.fn(),
}));

jest.mock('@/lib/calendar/slot-search', () => ({
  isSlotFree: jest.fn(),
}));

const mockedGet = getEventById as jest.MockedFunction<typeof getEventById>;
const mockedPatch = patchEvent as jest.MockedFunction<typeof patchEvent>;
const mockedFree = isSlotFree as jest.MockedFunction<typeof isSlotFree>;

function baseState(): ConversationState {
  return {
    sessionId: 's1',
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

describe('runRescheduleEvent chained', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFree.mockResolvedValue(true);
    mockedGet.mockResolvedValue({
      id: 'evt-stable',
      summary: 'Break',
      start: { dateTime: '2026-05-23T01:00:00.000Z' },
      end: { dateTime: '2026-05-23T01:15:00.000Z' },
    });
    mockedPatch.mockResolvedValue({
      id: 'evt-stable',
      summary: 'Break',
      start: { dateTime: '2026-05-23T02:00:00.000Z' },
      end: { dateTime: '2026-05-23T02:15:00.000Z' },
    });
  });

  test('patches in place and keeps same eventId for follow-up', async () => {
    const state = baseState();
    const { result, stateUpdates } = await runRescheduleEvent(
      'evt-stable',
      '2026-05-23T02:00:00.000Z',
      '2026-05-23T02:15:00.000Z',
      true,
      'America/New_York',
      state
    );

    expect(result).toMatchObject({ success: true, eventId: 'evt-stable' });
    expect(mockedPatch).toHaveBeenCalledWith(
      'evt-stable',
      '2026-05-23T02:00:00.000Z',
      '2026-05-23T02:15:00.000Z',
      'Break'
    );
    expect(stateUpdates.lastRescheduledEvent?.eventId).toBe('evt-stable');
  });

  test('uses lastRescheduledEvent when stale id not found', async () => {
    mockedGet.mockImplementation(async (id: string) => {
      if (id === 'evt-stable') {
        return {
          id: 'evt-stable',
          summary: 'Break',
          start: { dateTime: '2026-05-23T02:00:00.000Z' },
          end: { dateTime: '2026-05-23T02:15:00.000Z' },
        };
      }
      return null;
    });

    const state: ConversationState = {
      ...baseState(),
      lastRescheduledEvent: {
        eventId: 'evt-stable',
        summary: 'Break',
        start: '2026-05-23T02:00:00.000Z',
        end: '2026-05-23T02:15:00.000Z',
        display: '9:00 PM',
        day: '2026-05-23',
      },
    };

    const { result } = await runRescheduleEvent(
      'deleted-old-id',
      '2026-05-23T03:00:00.000Z',
      '2026-05-23T03:15:00.000Z',
      true,
      'America/New_York',
      state
    );

    expect(result).toMatchObject({ success: true, eventId: 'evt-stable' });
    expect(mockedPatch).toHaveBeenCalled();
  });
});
