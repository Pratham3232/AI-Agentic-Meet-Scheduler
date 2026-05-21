import {
  parseTimeHint,
  scoreEventMatch,
  identifyEvents,
} from '@/lib/agent/event-matcher';
import type { CalendarEvent } from '@/types';

/** UTC instants for America/New_York afternoon on 2026-05-23 (EDT, UTC-4). */
const NY_AFTERNOON = {
  fourPm: '2026-05-23T20:00:00.000Z',
  sevenPm: '2026-05-23T23:00:00.000Z',
  nineAm: '2026-05-23T13:00:00.000Z',
  tenAm: '2026-05-23T14:00:00.000Z',
  twoPm: '2026-05-23T18:00:00.000Z',
  threePm: '2026-05-23T19:00:00.000Z',
  fourThirty: '2026-05-23T20:30:00.000Z',
  sixThirty: '2026-05-23T22:30:00.000Z',
};

function mockEvent(
  id: string,
  start: string,
  end: string,
  summary: string
): CalendarEvent {
  return {
    id,
    summary,
    start: { dateTime: start },
    end: { dateTime: end },
  };
}

describe('parseTimeHint', () => {
  test('parses "4 to 7" as afternoon hours', () => {
    const r = parseTimeHint('4 to 7');
    expect(r).not.toBeNull();
    expect(r!.startHour).toBe(16);
    expect(r!.endHour).toBe(19);
  });

  test('parses explicit pm range', () => {
    const r = parseTimeHint('4pm-7pm');
    expect(r!.startHour).toBe(16);
    expect(r!.endHour).toBe(19);
  });

  test('parses morning range without pm', () => {
    const r = parseTimeHint('9 to 11');
    expect(r!.startHour).toBe(9);
    expect(r!.endHour).toBe(11);
  });

  test('parses minutes', () => {
    const r = parseTimeHint('4:30 to 6:30');
    expect(r!.startHour).toBeCloseTo(16.5, 1);
    expect(r!.endHour).toBeCloseTo(18.5, 1);
  });
});

describe('identifyEvents', () => {
  const tz = 'America/New_York';
  const day = '2026-05-23';

  test('ranks overlapping afternoon event for "4 to 7"', () => {
    const events = [
      mockEvent('a', NY_AFTERNOON.fourPm, NY_AFTERNOON.sevenPm, 'Client call'),
      mockEvent('b', NY_AFTERNOON.nineAm, NY_AFTERNOON.tenAm, 'Morning standup'),
    ];
    const result = identifyEvents(events, { timeHint: '4 to 7', day }, tz);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.bestMatch?.id).toBe('a');
    expect(result.ambiguous).toBe(false);
  });

  test('marks ambiguous when scores are close', () => {
    const events = [
      mockEvent('a', NY_AFTERNOON.fourPm, '2026-05-23T21:00:00.000Z', 'Meeting A'),
      mockEvent('b', NY_AFTERNOON.fourThirty, '2026-05-23T21:30:00.000Z', 'Meeting B'),
    ];
    const result = identifyEvents(events, { timeHint: '4 to 7', day }, tz);
    expect(result.matches.length).toBeGreaterThan(1);
    expect(result.ambiguous).toBe(true);
    expect(result.bestMatch).toBeUndefined();
  });

  test('summary hint boosts score', () => {
    const events = [
      mockEvent('a', NY_AFTERNOON.twoPm, NY_AFTERNOON.threePm, 'Team standup'),
      mockEvent('b', NY_AFTERNOON.twoPm, NY_AFTERNOON.threePm, 'Lunch'),
    ];
    const result = identifyEvents(
      events,
      { timeHint: '2 to 3', day, summaryHint: 'standup' },
      tz
    );
    expect(result.bestMatch?.summary).toMatch(/standup/i);
  });
});

describe('scoreEventMatch', () => {
  test('returns 0 for all-day events without dateTime', () => {
    const event: CalendarEvent = {
      id: 'x',
      summary: 'Holiday',
      start: { date: '2026-05-23' },
      end: { date: '2026-05-24' },
    };
    expect(scoreEventMatch(event, { timeHint: '4 to 7', day: '2026-05-23' }, 'UTC')).toBe(0);
  });
});
