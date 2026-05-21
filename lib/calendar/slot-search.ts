import { getCalendarClient } from './auth';
import { CalendarEvent, TimeSlot, WorkingHours } from '@/types';
import { addMinutes, parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { DebugLogger } from '../debug';

const SLOT_INTERVAL_MINUTES = 30;
const MAX_SLOTS_RETURNED = 5;
const MAX_ALL_SLOTS = 48;

export interface BusyBlock {
  start: Date;
  end: Date;
}

export interface BlockerInfo {
  summary: string;
  start: string;
  end: string;
  display: string;
}

function snapToNextBoundary(date: Date): Date {
  const mins = date.getMinutes();
  const remainder = mins % SLOT_INTERVAL_MINUTES;
  if (remainder === 0) return date;
  return addMinutes(date, SLOT_INTERVAL_MINUTES - remainder);
}

function slotStepMinutes(durationMinutes: number): number {
  return Math.max(SLOT_INTERVAL_MINUTES, durationMinutes);
}

export async function queryBusyBlocks(
  startTime: string,
  endTime: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<BusyBlock[]> {
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
  return busySlots
    .map(b => ({ start: parseISO(b.start!), end: parseISO(b.end!) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function collectFreeSlots(
  busy: BusyBlock[],
  windowStart: Date,
  windowEnd: Date,
  durationMinutes: number,
  maxSlots: number
): TimeSlot[] {
  const freeSlots: TimeSlot[] = [];
  const step = slotStepMinutes(durationMinutes);
  let cursor = snapToNextBoundary(windowStart);

  for (const block of busy) {
    while (cursor < block.start && freeSlots.length < maxSlots) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      if (slotEnd <= block.start && slotEnd <= windowEnd) {
        freeSlots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
      }
      cursor = addMinutes(cursor, step);
    }
    if (freeSlots.length >= maxSlots) break;
    if (block.end > cursor) {
      cursor = snapToNextBoundary(block.end);
    }
  }

  while (cursor < windowEnd && freeSlots.length < maxSlots) {
    const slotEnd = addMinutes(cursor, durationMinutes);
    if (slotEnd <= windowEnd) {
      freeSlots.push({ start: cursor.toISOString(), end: slotEnd.toISOString() });
    }
    cursor = addMinutes(cursor, step);
  }

  return freeSlots;
}

/** First N free slots from window start (legacy behavior). */
export async function findFreeSlots(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary',
  debug?: DebugLogger
): Promise<TimeSlot[]> {
  const busy = await queryBusyBlocks(startTime, endTime, calendarId);
  const slots = collectFreeSlots(
    busy,
    parseISO(startTime),
    parseISO(endTime),
    durationMinutes,
    MAX_SLOTS_RETURNED
  );

  debug?.log({
    type: 'freebusy_result',
    busyCount: busy.length,
    freeCount: slots.length,
    strategy: 'primary_window',
  });

  return slots;
}

/** All free slots in a window (capped). */
export async function findAllFreeSlotsInWindow(
  startTime: string,
  endTime: string,
  durationMinutes: number,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<TimeSlot[]> {
  const busy = await queryBusyBlocks(startTime, endTime, calendarId);
  return collectFreeSlots(
    busy,
    parseISO(startTime),
    parseISO(endTime),
    durationMinutes,
    MAX_ALL_SLOTS
  );
}

export function rankSlotsByProximity(anchor: Date, slots: TimeSlot[]): TimeSlot[] {
  const anchorMs = anchor.getTime();
  return [...slots].sort((a, b) => {
    const distA = Math.abs(parseISO(a.start).getTime() - anchorMs);
    const distB = Math.abs(parseISO(b.start).getTime() - anchorMs);
    if (distA !== distB) return distA - distB;
    return parseISO(a.start).getTime() - parseISO(b.start).getTime();
  });
}

export function filterFutureSlots(slots: TimeSlot[], now: Date = new Date()): TimeSlot[] {
  const nowMs = now.getTime();
  return slots.filter(s => parseISO(s.start).getTime() >= nowMs);
}

export async function isSlotFree(
  startTime: string,
  endTime: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<boolean> {
  const busy = await queryBusyBlocks(startTime, endTime, calendarId);
  const start = parseISO(startTime);
  const end = parseISO(endTime);
  for (const block of busy) {
    if (start < block.end && end > block.start) {
      return false;
    }
  }
  return true;
}

export function eventsOverlappingRange(
  events: CalendarEvent[],
  rangeStart: string,
  rangeEnd: string
): CalendarEvent[] {
  const rs = parseISO(rangeStart).getTime();
  const re = parseISO(rangeEnd).getTime();
  return events.filter(e => {
    if (!e.start?.dateTime || !e.end?.dateTime) return false;
    const es = parseISO(e.start.dateTime).getTime();
    const ee = parseISO(e.end.dateTime).getTime();
    return es < re && ee > rs;
  });
}

/** Build UTC ISO range for a local time on a given day. */
export function buildLocalSlotRange(
  day: string,
  hour: number,
  minute: number,
  durationMinutes: number,
  timezone: string
): { start: string; end: string } {
  const startLocal = `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const start = fromZonedTime(startLocal, timezone);
  const end = addMinutes(start, durationMinutes);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Parse "10:00", "10 AM", or ISO into hour/minute for a given day. */
export function parsePreferredTime(
  input: string,
  day: string,
  timezone: string
): { start: string; end?: string; anchor: Date } | null {
  const trimmed = input.trim();

  const isoRange = trimmed.match(
    /^(\d{4}-\d{2}-\d{2}T[\d:.+-Z]+)\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2}T[\d:.+-Z]+)$/i
  );
  if (isoRange) {
    return {
      start: isoRange[1],
      end: isoRange[2],
      anchor: parseISO(isoRange[1]),
    };
  }

  const singleIso = trimmed.match(/^\d{4}-\d{2}-\d{2}T/);
  if (singleIso) {
    const start = trimmed;
    return { start, anchor: parseISO(start) };
  }

  const rangeMatch = trimmed.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
  if (rangeMatch) {
    const startHm = toHourMinute(rangeMatch[1], rangeMatch[2], rangeMatch[3]);
    const endHm = toHourMinute(rangeMatch[4], rangeMatch[5], rangeMatch[6]);
    const startRange = buildLocalSlotRange(day, startHm.hour, startHm.minute, 1, timezone);
    const endRange = buildLocalSlotRange(day, endHm.hour, endHm.minute, 1, timezone);
    return {
      start: startRange.start,
      end: endRange.end,
      anchor: parseISO(startRange.start),
    };
  }

  const timeMatch = trimmed.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    const { hour, minute } = toHourMinute(timeMatch[1], timeMatch[2], timeMatch[3]);
    const range = buildLocalSlotRange(day, hour, minute, 1, timezone);
    return { start: range.start, anchor: parseISO(range.start) };
  }

  const hhmm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hour = parseInt(hhmm[1], 10);
    const minute = parseInt(hhmm[2], 10);
    const range = buildLocalSlotRange(day, hour, minute, 1, timezone);
    return { start: range.start, anchor: parseISO(range.start) };
  }

  return null;
}

function toHourMinute(
  hStr: string,
  mStr: string | undefined,
  ampm: string | undefined
): { hour: number; minute: number } {
  let hour = parseInt(hStr, 10);
  const minute = mStr ? parseInt(mStr, 10) : 0;
  if (ampm) {
    const lower = ampm.toLowerCase();
    if (lower === 'pm' && hour < 12) hour += 12;
    if (lower === 'am' && hour === 12) hour = 0;
  }
  return { hour, minute };
}

export function workingDayBounds(
  day: string,
  timezone: string,
  workingHours?: WorkingHours
): { start: string; end: string } {
  const startH = workingHours?.startHour ?? 9;
  const endH = workingHours?.endHour ?? 17;
  const start = fromZonedTime(`${day}T${String(startH).padStart(2, '0')}:00:00`, timezone);
  const end = fromZonedTime(`${day}T${String(endH).padStart(2, '0')}:00:00`, timezone);
  return { start: start.toISOString(), end: end.toISOString() };
}
