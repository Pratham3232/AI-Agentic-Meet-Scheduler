import { parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { CalendarEvent } from '@/types';
import { formatTimeSlot } from '@/lib/calendar/utils';
import { createEvent, deleteEvent, listEvents } from '@/lib/calendar/events';
import { isSlotFree } from '@/lib/calendar/slot-search';

export interface TimeHintRange {
  startHour: number;
  endHour: number;
}

export interface IdentifyCriteria {
  timeHint?: string;
  summaryHint?: string;
  day?: string;
  timezone?: string;
}

export interface EventMatch {
  id: string;
  summary: string;
  display: string;
  score: number;
  start: string;
  end: string;
}

export interface IdentifyEventsResult {
  eventsListed: number;
  matches: EventMatch[];
  bestMatch?: EventMatch;
  ambiguous: boolean;
  hint: string;
}

export interface ReschedulePreview {
  eventId: string;
  oldDisplay: string;
  newDisplay: string;
  newStartTime: string;
  newEndTime: string;
  needsConfirmation: true;
}

export interface RescheduleSuccess {
  success: true;
  display: string;
  eventId: string;
}

export interface RescheduleError {
  success: false;
  error: string;
  hint?: string;
}

export type RescheduleResult = ReschedulePreview | RescheduleSuccess | RescheduleError;

function parseHourMinute(h: string, m?: string, meridiem?: string): number {
  let hour = parseInt(h, 10);
  const minute = m ? parseInt(m, 10) / 60 : 0;
  const mer = meridiem?.toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  return hour + minute;
}

function applyImplicitMeridiem(
  startHour: number,
  endHour: number,
  normalized: string
): TimeHintRange {
  if (normalized.includes('pm')) {
    return {
      startHour: startHour < 12 ? startHour + 12 : startHour,
      endHour: endHour < 12 ? endHour + 12 : endHour,
    };
  }
  if (normalized.includes('am')) return { startHour, endHour };

  // "4 to 7" / "4-7" → afternoon; "9 to 11" → morning
  if (startHour < 8 && endHour <= 8) {
    return {
      startHour: startHour < 12 ? startHour + 12 : startHour,
      endHour: endHour < 12 ? endHour + 12 : endHour,
    };
  }
  return { startHour, endHour };
}

/** Parse phrases like "4 to 7", "4-7pm", "4:00–7:00" into local hour range. */
export function parseTimeHint(hint: string): TimeHintRange | null {
  const normalized = hint
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');

  const rangeRe =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const m = normalized.match(rangeRe);
  if (!m) return null;

  const [, h1, min1, mer1, h2, min2, mer2] = m;
  const trailingMer = normalized.includes('pm') ? 'pm' : normalized.includes('am') ? 'am' : undefined;
  let startHour = parseHourMinute(h1, min1, mer1 || trailingMer);
  let endHour = parseHourMinute(h2, min2, mer2 || mer1 || trailingMer);

  if (!mer1 && !mer2 && !trailingMer) {
    return applyImplicitMeridiem(startHour, endHour, normalized);
  }

  if (endHour <= startHour) endHour += 12;
  return { startHour, endHour };
}

function eventLocalHours(
  event: CalendarEvent,
  timezone: string
): { day: string; startHour: number; endHour: number } | null {
  const startIso = event.start?.dateTime;
  const endIso = event.end?.dateTime;
  if (!startIso || !endIso) return null;

  const start = parseISO(startIso);
  const end = parseISO(endIso);
  const day = formatInTimeZone(start, timezone, 'yyyy-MM-dd');
  const startParts = formatInTimeZone(start, timezone, 'H:m').split(':').map(Number);
  const endParts = formatInTimeZone(end, timezone, 'H:m').split(':').map(Number);
  const startHour = startParts[0] + (startParts[1] ?? 0) / 60;
  const endHour = endParts[0] + (endParts[1] ?? 0) / 60;
  return { day, startHour, endHour };
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function scoreEventMatch(
  event: CalendarEvent,
  criteria: IdentifyCriteria,
  timezone: string = 'UTC'
): number {
  const startIso = event.start?.dateTime;
  const endIso = event.end?.dateTime;
  if (!startIso || !endIso) return 0;

  let score = 0;
  const local = eventLocalHours(event, timezone);
  if (!local) return 0;

  if (criteria.day && local.day === criteria.day) score += 30;

  if (criteria.timeHint) {
    const range = parseTimeHint(criteria.timeHint);
    if (range) {
      const overlap = rangesOverlap(
        local.startHour,
        local.endHour,
        range.startHour,
        range.endHour
      );
      if (overlap) {
        const overlapStart = Math.max(local.startHour, range.startHour);
        const overlapEnd = Math.min(local.endHour, range.endHour);
        const overlapLen = Math.max(0, overlapEnd - overlapStart);
        const eventLen = Math.max(0.25, local.endHour - local.startHour);
        score += 50 + Math.round((overlapLen / eventLen) * 20);
      }
    }
  }

  if (criteria.summaryHint) {
    const summary = (event.summary ?? '').toLowerCase();
    const hint = criteria.summaryHint.toLowerCase();
    if (summary.includes(hint) || hint.includes(summary)) score += 25;
    else {
      const words = hint.split(/\s+/).filter(w => w.length > 2);
      const matched = words.filter(w => summary.includes(w)).length;
      score += matched * 8;
    }
  }

  return score;
}

export function identifyEvents(
  events: CalendarEvent[],
  criteria: IdentifyCriteria,
  timezone: string = 'UTC'
): IdentifyEventsResult {
  const timed = events.filter(e => e.start?.dateTime && e.end?.dateTime);
  const scored = timed
    .map(e => {
      const score = scoreEventMatch(e, criteria, timezone);
      const start = e.start!.dateTime!;
      const end = e.end!.dateTime!;
      return {
        id: e.id,
        summary: e.summary ?? '(no title)',
        display: formatTimeSlot({ start, end }, timezone),
        score,
        start,
        end,
      };
    })
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score);

  const matches = scored.slice(0, 5);
  const best = matches[0];
  const second = matches[1];
  const ambiguous =
    matches.length > 1 &&
    (!best || !second || best.score - second.score < 15);

  let hint = 'No matching events in this range.';
  if (matches.length === 0) {
    hint = 'No events matched. Widen timeMin/timeMax or adjust timeHint/summaryHint.';
  } else if (ambiguous) {
    hint = 'Multiple plausible matches — ask the user to pick by number before rescheduling.';
  } else if (best) {
    hint = 'Single best match — ask ONE confirmation, then reschedule_event with confirmed=true.';
  }

  return {
    eventsListed: timed.length,
    matches,
    bestMatch: ambiguous ? undefined : best,
    ambiguous,
    hint,
  };
}

export async function runIdentifyEvent(
  timeMin: string,
  timeMax: string,
  criteria: IdentifyCriteria,
  timezone: string
): Promise<IdentifyEventsResult> {
  const events = await listEvents(timeMin, timeMax);
  return identifyEvents(events, { ...criteria, timezone }, timezone);
}

export async function runRescheduleEvent(
  eventId: string,
  newStartTime: string,
  newEndTime: string,
  confirmed: boolean,
  timezone: string
): Promise<RescheduleResult> {
  const events = await listEvents(
    new Date(Date.now() - 90 * 86400000).toISOString(),
    new Date(Date.now() + 365 * 86400000).toISOString()
  );
  const existing = events.find(e => e.id === eventId);
  if (!existing?.start?.dateTime || !existing.end?.dateTime) {
    return {
      success: false,
      error: 'Event not found. Call identify_event again.',
      hint: 'Use list_events + identify_event for the correct day.',
    };
  }

  const oldDisplay = formatTimeSlot(
    { start: existing.start.dateTime, end: existing.end.dateTime },
    timezone
  );
  const newDisplay = formatTimeSlot(
    { start: newStartTime, end: newEndTime },
    timezone
  );

  if (!confirmed) {
    const free = await isSlotFree(newStartTime, newEndTime);
    if (!free) {
      return {
        success: false,
        error: 'The new time conflicts with another event.',
        hint: 'Call find_free_slots for alternatives, then reschedule_event again.',
      };
    }
    return {
      eventId,
      oldDisplay,
      newDisplay,
      newStartTime,
      newEndTime,
      needsConfirmation: true,
    };
  }

  const free = await isSlotFree(newStartTime, newEndTime);
  if (!free) {
    return {
      success: false,
      error: 'The new time is no longer available.',
      hint: 'Call find_free_slots and try again.',
    };
  }

  try {
    await deleteEvent(eventId);
  } catch {
    return {
      success: false,
      error: 'Could not delete the original event (may already be removed).',
    };
  }

  const summary = existing.summary ?? 'Meeting';
  const created = await createEvent(summary, newStartTime, newEndTime);
  const display = formatTimeSlot(
    { start: created.start.dateTime || newStartTime, end: created.end.dateTime || newEndTime },
    timezone
  );

  return { success: true, display, eventId: created.id };
}
