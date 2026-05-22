import { executeFindFreeSlots } from '@/lib/agent/find-slots';
import { listEvents } from '@/lib/calendar/events';
import { findAllFreeSlotsInWindow } from '@/lib/calendar/slot-search';
import { DebugLogger } from '@/lib/debug';

jest.mock('@/lib/calendar/events', () => ({
  listEvents: jest.fn(),
  createEvent: jest.fn(),
}));

jest.mock('@/lib/calendar/slot-search', () => ({
  findFreeSlots: jest.fn(),
  findAllFreeSlotsInWindow: jest.fn(),
  rankSlotsByProximity: jest.requireActual('@/lib/calendar/slot-search')
    .rankSlotsByProximity,
  filterFutureSlots: jest.requireActual('@/lib/calendar/slot-search')
    .filterFutureSlots,
  isSlotFree: jest.fn(),
  eventsOverlappingRange: jest.requireActual('@/lib/calendar/slot-search')
    .eventsOverlappingRange,
  parsePreferredTime: jest.requireActual('@/lib/calendar/slot-search')
    .parsePreferredTime,
}));

const mockedList = listEvents as jest.MockedFunction<typeof listEvents>;
const mockedAll = findAllFreeSlotsInWindow as jest.MockedFunction<
  typeof findAllFreeSlotsInWindow
>;

const TZ = 'UTC';
const DAY = '2026-05-23';
const NOW = new Date('2026-05-23T12:00:00Z');

describe('executeFindFreeSlots bufferAfterLastMeetingMinutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedList.mockResolvedValue([
      {
        id: 'busy-1',
        summary: 'Afternoon call',
        start: { dateTime: '2026-05-23T18:00:00.000Z' },
        end: { dateTime: '2026-05-23T19:00:00.000Z' },
      },
    ] as never);
    mockedAll.mockResolvedValue([
      {
        start: '2026-05-23T23:00:00.000Z',
        end: '2026-05-23T23:30:00.000Z',
      },
    ]);
  });

  test('raises search window start after last meeting + buffer', async () => {
    const result = await executeFindFreeSlots(
      {
        duration: 30,
        day: DAY,
        timeWindow: 'evening',
        preferredStartTime: '7:00 PM',
        bufferAfterLastMeetingMinutes: 60,
      },
      TZ,
      new DebugLogger(),
      { startHour: 9, endHour: 22 },
      NOW
    );

    expect(result.earliestAllowedDisplay).toBeDefined();
    expect(result.hint).toMatch(/Do not ask the user when their last meeting ends/i);
    const call = mockedAll.mock.calls[0];
    expect(call).toBeDefined();
    const searchStart = new Date(call![0]).getTime();
    const lastEndPlusBuffer = new Date('2026-05-23T19:00:00.000Z').getTime();
    expect(searchStart).toBeGreaterThanOrEqual(lastEndPlusBuffer - 1000);
  });
});
