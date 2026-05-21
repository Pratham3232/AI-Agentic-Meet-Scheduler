import {
  rankSlotsByProximity,
  eventsOverlappingRange,
  parsePreferredTime,
} from '@/lib/calendar/slot-search';
import { CalendarEvent } from '@/types';

describe('rankSlotsByProximity', () => {
  it('orders slots nearest to anchor first', () => {
    const anchor = new Date('2026-05-21T10:00:00Z');
    const slots = [
      { start: '2026-05-21T07:00:00Z', end: '2026-05-21T07:30:00Z' },
      { start: '2026-05-21T09:30:00Z', end: '2026-05-21T10:00:00Z' },
      { start: '2026-05-21T10:30:00Z', end: '2026-05-21T11:00:00Z' },
      { start: '2026-05-21T09:00:00Z', end: '2026-05-21T09:30:00Z' },
    ];
    const ranked = rankSlotsByProximity(anchor, slots);
    expect(ranked[0].start).toBe('2026-05-21T09:30:00Z');
    expect(ranked[1].start).toBe('2026-05-21T10:30:00Z');
    expect(ranked[2].start).toBe('2026-05-21T09:00:00Z');
    expect(ranked[3].start).toBe('2026-05-21T07:00:00Z');
  });
});

describe('eventsOverlappingRange', () => {
  it('returns only events overlapping the range', () => {
    const events: CalendarEvent[] = [
      {
        id: '1',
        summary: 'Standup',
        start: { dateTime: '2026-05-21T09:00:00Z' },
        end: { dateTime: '2026-05-21T09:30:00Z' },
      },
      {
        id: '2',
        summary: 'Later',
        start: { dateTime: '2026-05-21T14:00:00Z' },
        end: { dateTime: '2026-05-21T15:00:00Z' },
      },
    ];
    const overlapping = eventsOverlappingRange(
      events,
      '2026-05-21T09:00:00Z',
      '2026-05-21T11:00:00Z'
    );
    expect(overlapping).toHaveLength(1);
    expect(overlapping[0].summary).toBe('Standup');
  });
});

describe('parsePreferredTime', () => {
  it('parses clock time on a day', () => {
    const result = parsePreferredTime('10 AM', '2026-05-21', 'America/New_York');
    expect(result).not.toBeNull();
    expect(result!.anchor).toBeInstanceOf(Date);
  });

  it('parses time ranges', () => {
    const result = parsePreferredTime('9 am to 11 am', '2026-05-21', 'UTC');
    expect(result).not.toBeNull();
    expect(result!.end).toBeDefined();
  });
});
