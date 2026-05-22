import {
  initBookingJob,
  executeBookingBatch,
  getBookingProgress,
  evaluateInitBookingBlock,
  type InitBookingJobResult,
  type BookingJobEntryInput,
} from '@/lib/agent/booking-executor';
import { createEvent, listEvents } from '@/lib/calendar/events';
import { isSlotFree } from '@/lib/calendar/slot-search';

jest.mock('@/lib/calendar/events', () => ({
  createEvent: jest.fn(),
  listEvents: jest.fn(),
}));

jest.mock('@/lib/calendar/slot-search', () => ({
  isSlotFree: jest.fn(),
  eventsOverlappingRange: jest.requireActual('@/lib/calendar/slot-search').eventsOverlappingRange,
}));

const mockedCreate = createEvent as jest.MockedFunction<typeof createEvent>;
const mockedList = listEvents as jest.MockedFunction<typeof listEvents>;
const mockedFree = isSlotFree as jest.MockedFunction<typeof isSlotFree>;

async function mustInit(entries: BookingJobEntryInput[]): Promise<InitBookingJobResult> {
  const r = await initBookingJob(entries);
  if ('error' in r) throw new Error(r.message);
  return r;
}

describe('booking-executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedList.mockResolvedValue([]);
    mockedFree.mockResolvedValue(true);
    mockedCreate.mockImplementation(async (summary, start, end) => ({
      id: `evt-${start}`,
      summary,
      start: { dateTime: start },
      end: { dateTime: end },
    }));
  });

  test('initBookingJob creates pending items', async () => {
    const { job, total } = await mustInit([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
      { day: '2026-05-21', start: '2026-05-21T14:00:00Z', end: '2026-05-21T15:00:00Z', summary: 'B' },
    ]);
    expect(total).toBe(2);
    expect(job.status).toBe('in_progress');
    expect(job.items.every((i: { status: string }) => i.status === 'pending')).toBe(true);
  });

  test('executeBookingBatch books up to batchSize items', async () => {
    const { job } = await mustInit([
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
    const { job } = await mustInit([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
    ]);
    const result = await executeBookingBatch(job, 5);
    expect(result.failedThisBatch).toBe(1);
    expect(result.job.items[0].status).toBe('failed');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test('reconciles existing calendar event instead of failing', async () => {
    mockedFree.mockResolvedValue(false);
    mockedList
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: 'existing-1',
          summary: 'Break',
          start: { dateTime: '2026-05-20T14:00:00Z' },
          end: { dateTime: '2026-05-20T15:00:00Z' },
        },
      ] as any);

    const { job } = await mustInit([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'Break' },
    ]);
    const result = await executeBookingBatch(job, 5);
    expect(result.reconciledThisBatch).toBe(1);
    expect(result.job.items[0].status).toBe('booked');
    expect(result.job.items[0].eventId).toBe('existing-1');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  test('blocks duplicate init for same fingerprint', async () => {
    const first = await initBookingJob([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
    ]);
    if ('error' in first) throw new Error('expected success');
    const second = await initBookingJob(
      [{ day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' }],
      'UTC',
      first.job
    );
    expect('error' in second).toBe(true);
  });

  test('blocks re-init when calendar already has events (different fingerprint)', async () => {
    mockedList.mockResolvedValue([
      {
        id: 'e1',
        summary: 'Break',
        start: { dateTime: '2026-07-27T01:00:00Z' },
        end: { dateTime: '2026-07-27T01:15:00Z' },
      },
    ] as any);

    const blocked = await evaluateInitBookingBlock(
      [
        {
          day: '2026-07-27',
          start: '2026-07-27T01:00:00Z',
          end: '2026-07-27T01:15:00Z',
          summary: 'Break',
        },
      ],
      'UTC',
      null
    );
    expect(blocked?.error).toBe('job_already_done');
  });

  test('blocks re-init after completed job regardless of fingerprint', async () => {
    const { job } = await mustInit([
      { day: '2026-05-20', start: '2026-05-20T14:00:00Z', end: '2026-05-20T15:00:00Z', summary: 'A' },
    ]);
    const done = await executeBookingBatch(job, 5);
    const completed = done.job;

    const blocked = await initBookingJob(
      [
        {
          day: '2026-05-20',
          start: '2026-05-20T14:00:01Z',
          end: '2026-05-20T15:00:01Z',
          summary: 'A',
        },
      ],
      'UTC',
      completed
    );
    expect('error' in blocked).toBe(true);
  });

  test('getBookingProgress percent reflects finished items', async () => {
    const { job } = await mustInit([
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
