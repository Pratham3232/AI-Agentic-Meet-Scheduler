import {
  initBookingJob,
  executeBookingBatch,
  getBookingProgress,
} from '@/lib/agent/booking-executor';
import { createEvent } from '@/lib/calendar/events';
import { isSlotFree } from '@/lib/calendar/slot-search';

jest.mock('@/lib/calendar/events', () => ({
  createEvent: jest.fn(),
}));

jest.mock('@/lib/calendar/slot-search', () => ({
  isSlotFree: jest.fn(),
}));

const mockedCreate = createEvent as jest.MockedFunction<typeof createEvent>;
const mockedFree = isSlotFree as jest.MockedFunction<typeof isSlotFree>;

describe('booking-executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFree.mockResolvedValue(true);
    mockedCreate.mockImplementation(async (summary, start, end) => ({
      id: `evt-${start}`,
      summary,
      start: { dateTime: start },
      end: { dateTime: end },
    }));
  });

  test('initBookingJob creates pending items', () => {
    const { job, total } = initBookingJob([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
      { day: '2026-05-21', start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z', summary: 'B' },
    ]);
    expect(total).toBe(2);
    expect(job.status).toBe('in_progress');
    expect(job.items.every(i => i.status === 'pending')).toBe(true);
  });

  test('executeBookingBatch books up to batchSize items', async () => {
    const { job } = initBookingJob([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
      { day: '2026-05-21', start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z', summary: 'B' },
      { day: '2026-05-22', start: '2026-05-22T14:00:00Z', end: '2026-05-22T15:00:00Z', summary: 'C' },
    ]);

    const result = await executeBookingBatch(job, 2);
    expect(result.bookedThisBatch).toBe(2);
    expect(result.progress.pending).toBe(1);
    expect(result.done).toBe(false);
    expect(mockedCreate).toHaveBeenCalledTimes(2);
  });

  test('marks item failed when slot not free', async () => {
    mockedFree.mockResolvedValueOnce(false);
    const { job } = initBookingJob([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
    ]);
    const result = await executeBookingBatch(job, 5);
    expect(result.failedThisBatch).toBe(1);
    expect(result.job.items[0].status).toBe('failed');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test('getBookingProgress percent reflects finished items', async () => {
    const { job } = initBookingJob([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
      { day: '2026-05-21', start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z', summary: 'B' },
    ]);
    const after = await executeBookingBatch(job, 1);
    const p = getBookingProgress(after.job);
    expect(p.percent).toBe(50);
    expect(p.booked).toBe(1);
    expect(p.pending).toBe(1);
  });
});
