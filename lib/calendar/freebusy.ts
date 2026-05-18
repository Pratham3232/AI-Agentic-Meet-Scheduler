import { getCalendarClient } from './auth';
import { TimeSlot } from '@/types';
import { addMinutes, parseISO } from 'date-fns';
import { DebugLogger } from '../debug';

const SLOT_INTERVAL_MINUTES = 30; // only offer clean half-hour boundaries
const MAX_SLOTS_RETURNED = 5;

/**
 * Snaps a date forward to the next clean slot boundary (e.g. :00 or :30).
 */
function snapToNextBoundary(date: Date): Date {
  const mins = date.getMinutes();
  const remainder = mins % SLOT_INTERVAL_MINUTES;
  if (remainder === 0) return date;
  return addMinutes(date, SLOT_INTERVAL_MINUTES - remainder);
}

export async function findFreeSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary',
  debug?: DebugLogger
): Promise<TimeSlot[]> {
  const calendar = await getCalendarClient();

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startTime,
      timeMax: endTime,
      items: [{ id: calendarId }],
      timeZone: 'UTC',
    },
  });

  const busySlots = response.data.calendars?.[calendarId]?.busy ?? [];
  const freeSlots: TimeSlot[] = [];

  // Sort busy blocks (API usually returns sorted, but be safe)
  const busy = busySlots
    .map(b => ({ start: parseISO(b.start!), end: parseISO(b.end!) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const windowStart = parseISO(startTime);
  const windowEnd   = parseISO(endTime);

  // Walk the free gaps between busy blocks
  let cursor = snapToNextBoundary(windowStart);

  for (const block of busy) {
    // Fill free time before this busy block
    while (cursor < block.start) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      if (slotEnd <= block.start && slotEnd <= windowEnd) {
        freeSlots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
        if (freeSlots.length >= MAX_SLOTS_RETURNED) break;
      }
      cursor = addMinutes(cursor, SLOT_INTERVAL_MINUTES);
    }
    if (freeSlots.length >= MAX_SLOTS_RETURNED) break;

    // Skip past the busy block, snap to next boundary
    if (block.end > cursor) {
      cursor = snapToNextBoundary(block.end);
    }
  }

  // Fill remaining free time after all busy blocks
  while (cursor < windowEnd && freeSlots.length < MAX_SLOTS_RETURNED) {
    const slotEnd = addMinutes(cursor, durationMinutes);
    if (slotEnd <= windowEnd) {
      freeSlots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
    }
    cursor = addMinutes(cursor, SLOT_INTERVAL_MINUTES);
  }

  debug?.log({
    type: 'freebusy_result',
    busyCount: busy.length,
    freeCount: freeSlots.length,
    strategy: 'primary_window',
  });

  return freeSlots;
}
