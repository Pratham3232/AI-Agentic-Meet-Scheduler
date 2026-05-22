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

  test('next month weekdays resolves all Mon–Fri in June 2026 (not first week only)', () => {
    const days = parseBookingDayRequest(
      'book yoga next month weekdays 5am',
      TZ,
      TODAY
    );
    expect(days).not.toBeNull();
    expect(days!.length).toBeGreaterThanOrEqual(20);
    expect(days!.length).toBeLessThanOrEqual(23);
    expect(days![0]).toBe('2026-06-01');
    expect(days![days!.length - 1]).toBe('2026-06-30');
    expect(days).not.toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  test('every day next month resolves all calendar days in June 2026', () => {
    const days = parseBookingDayRequest(
      'book yoga every day next month at 5am',
      TZ,
      TODAY
    );
    expect(days).toHaveLength(30);
    expect(days![0]).toBe('2026-06-01');
    expect(days![29]).toBe('2026-06-30');
  });

  test('this month weekdays excludes past days in May 2026', () => {
    const days = parseBookingDayRequest(
      'book yoga this month weekdays at 9am',
      TZ,
      TODAY
    );
    expect(days).not.toBeNull();
    expect(days!.every(d => d >= '2026-05-21')).toBe(true);
    expect(days!.some(d => d < '2026-05-21')).toBe(false);
  });

  test('last week of july weekdays resolves Mon–Fri in July 2026', () => {
    const days = parseBookingDayRequest(
      'book meetings last week of july on weekdays at 9pm',
      TZ,
      new Date('2026-05-21T12:00:00Z')
    );
    expect(days).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ]);
  });
});
