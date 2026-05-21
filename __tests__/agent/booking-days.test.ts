import {
  parseBookingDayRequest,
  resolveFirstWeekOfMonth,
  resolveWeekdaysInRange,
} from '@/lib/agent/booking-days';

const TZ = 'America/New_York';
const TODAY = new Date('2026-05-21T12:00:00Z');

describe('booking-days', () => {
  test('first week of next month Mon–Fri resolves Jun 1–5 2026', () => {
    const days = parseBookingDayRequest(
      'book a 15 min break monday to friday first week of next month at 9pm',
      TZ,
      TODAY
    );
    expect(days).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  test('resolveFirstWeekOfMonth next month spans calendar days 1–7', () => {
    const week = resolveFirstWeekOfMonth(1, TZ, TODAY);
    expect(week.startDay).toBe('2026-06-01');
    expect(week.endDay).toBe('2026-06-07');
    expect(week.days).toHaveLength(7);
  });

  test('resolveWeekdaysInRange filters to Mon–Fri only', () => {
    const days = resolveWeekdaysInRange('2026-06-01', '2026-06-07', [1, 2, 3, 4, 5], TZ);
    expect(days).toHaveLength(5);
    expect(days[0]).toBe('2026-06-01');
    expect(days[4]).toBe('2026-06-05');
  });
});
