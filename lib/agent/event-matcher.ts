import { addMinutes, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { CalendarEvent, ConversationState } from '@/types';
import { formatTimeSlot } from '@/lib/calendar/utils';
import {
  getEventById,
  listEvents,
  patchEvent,
} from '@/lib/calendar/events';
import { isSlotFree } from '@/lib/calendar/slot-search';
import type { DebugLogger } from '@/lib/debug';
import {
  findCachedEventById,
  getCachedEventsForRange,
  setPendingReschedule,
  updateEventCache,
  upsertCachedEvent,
} from '@/lib/agent/event-cache';

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
  hint?: string;
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

  if (startHour < 8 && endHour <= 8) {
    return {
      startHour: startHour < 12 ? startHour + 12 : startHour,
      endHour: endHour < 12 ? endHour + 12 : endHour,
    };
  }
  return { startHour, endHour };
}

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
  timezone: string,
  state?: ConversationState,
  debug?: DebugLogger
): Promise<{ result: IdentifyEventsResult; stateUpdates: Partial<ConversationState> }> {
  let events: CalendarEvent[];
  const cached = state ? getCachedEventsForRange(state, timeMin, timeMax) : null;

  if (cached?.length) {
    events = cached.map(row => ({
      id: row.id,
      summary: row.summary,
      start: { dateTime: row.start },
      end: { dateTime: row.end },
    })) as CalendarEvent[];
  } else {
    events = await listEvents(timeMin, timeMax, undefined, debug, 50);
  }

  const result = identifyEvents(events, { ...criteria, timezone }, timezone);

  debug?.log({
    type: 'reschedule_identify',
    eventsListed: result.eventsListed,
    bestMatchId: result.bestMatch?.id,
    ambiguous: result.ambiguous,
  });

  const stateUpdates: Partial<ConversationState> = {};
  if (state) {
    let next = updateEventCache(state, timeMin, timeMax, events, timezone);
    if (result.bestMatch && !result.ambiguous) {
      const day =
        criteria.day ??
        formatInTimeZone(parseISO(result.bestMatch.start), timezone, 'yyyy-MM-dd');
      next = setPendingReschedule(next, {
        eventId: result.bestMatch.id,
        summary: result.bestMatch.summary,
        oldStart: result.bestMatch.start,
        oldEnd: result.bestMatch.end,
        oldDisplay: result.bestMatch.display,
        day,
      });
    } else {
      next = setPendingReschedule(next, null);
    }
    Object.assign(stateUpdates, {
      cachedCalendar: next.cachedCalendar,
      pendingReschedule: next.pendingReschedule,
    });
  }

  return { result, stateUpdates };
}

export async function runRescheduleEvent(
  eventId: string,
  newStartTime: string | undefined,
  newEndTime: string | undefined,
  confirmed: boolean,
  timezone: string,
  state?: ConversationState,
  debug?: DebugLogger,
  shiftMinutes?: number
): Promise<{ result: RescheduleResult; stateUpdates: Partial<ConversationState> }> {
  let existing: CalendarEvent | null = null;

  const cached = state ? findCachedEventById(state, eventId) : undefined;
  if (cached) {
    existing = {
      id: cached.id,
      summary: cached.summary,
      start: { dateTime: cached.start },
      end: { dateTime: cached.end },
    } as CalendarEvent;
  }

  if (!existing && state?.pendingReschedule?.eventId === eventId) {
    const p = state.pendingReschedule;
    existing = {
      id: p.eventId,
      summary: p.summary,
      start: { dateTime: p.oldStart },
      end: { dateTime: p.oldEnd },
    } as CalendarEvent;
  }

  if (!existing) {
    existing = await getEventById(eventId);
  }

  if (!existing?.start?.dateTime && state?.lastRescheduledEvent) {
    existing = await getEventById(state.lastRescheduledEvent.eventId);
  }

  if (!existing?.start?.dateTime || !existing.end?.dateTime) {
    debug?.log({
      type: 'reschedule_execute',
      eventId,
      confirmed,
      success: false,
      error: 'Event not found',
    });
    return {
      result: {
        success: false,
        error: 'Event not found. Call identify_event for that day again.',
        hint: 'Use the eventId from identify_event or the cached calendar block.',
      },
      stateUpdates: {},
    };
  }

  let resolvedStart = newStartTime;
  let resolvedEnd = newEndTime;
  if (shiftMinutes !== undefined && Number.isFinite(shiftMinutes)) {
    resolvedStart = addMinutes(
      parseISO(existing.start.dateTime),
      shiftMinutes
    ).toISOString();
    resolvedEnd = addMinutes(
      parseISO(existing.end.dateTime),
      shiftMinutes
    ).toISOString();
  } else if (!resolvedStart || !resolvedEnd) {
    return {
      result: {
        success: false,
        error: 'Provide newStartTime and newEndTime, or shiftMinutes for relative moves.',
        hint: 'For "30 minutes earlier/later", use shiftMinutes: -30 or +30 instead of manual ISO times.',
      },
      stateUpdates: {},
    };
  }

  const oldDisplay = formatTimeSlot(
    { start: existing.start.dateTime, end: existing.end.dateTime },
    timezone
  );
  const newDisplay = formatTimeSlot(
    { start: resolvedStart, end: resolvedEnd },
    timezone
  );

  if (!confirmed) {
    const free = await isSlotFree(resolvedStart, resolvedEnd);
    if (!free) {
      return {
        result: {
          success: false,
          error: 'The new time conflicts with another event.',
          hint: 'Call find_free_slots for alternatives, then reschedule_event again.',
        },
        stateUpdates: state
          ? {
              pendingReschedule: {
                eventId,
                summary: existing.summary ?? 'Meeting',
                oldStart: existing.start.dateTime,
                oldEnd: existing.end.dateTime,
                oldDisplay,
                day: formatInTimeZone(parseISO(existing.start.dateTime), timezone, 'yyyy-MM-dd'),
                newStartTime: resolvedStart,
                newEndTime: resolvedEnd,
                newDisplay,
              },
            }
          : {},
      };
    }
    const stateUpdates: Partial<ConversationState> = state
      ? {
          pendingReschedule: {
            eventId,
            summary: existing.summary ?? 'Meeting',
            oldStart: existing.start.dateTime,
            oldEnd: existing.end.dateTime,
            oldDisplay,
            day: formatInTimeZone(parseISO(existing.start.dateTime), timezone, 'yyyy-MM-dd'),
            newStartTime: resolvedStart,
            newEndTime: resolvedEnd,
            newDisplay,
          },
          awaitingConfirmation: true,
        }
      : {};
    return {
      result: {
        eventId,
        oldDisplay,
        newDisplay,
        newStartTime: resolvedStart,
        newEndTime: resolvedEnd,
        needsConfirmation: true,
        ...(shiftMinutes !== undefined ? { shiftMinutes } : {}),
      },
      stateUpdates,
    };
  }

  const free = await isSlotFree(resolvedStart, resolvedEnd);
  if (!free) {
    debug?.log({
      type: 'reschedule_execute',
      eventId,
      confirmed,
      success: false,
      error: 'Slot busy',
    });
    return {
      result: {
        success: false,
        error: 'The new time is no longer available.',
        hint: 'Call find_free_slots and try again.',
      },
      stateUpdates: {},
    };
  }

  const summary = existing.summary ?? 'Meeting';
  const stableId = existing.id ?? eventId;

  try {
    const patched = await patchEvent(stableId, resolvedStart, resolvedEnd, summary);
    const display = formatTimeSlot(
      {
        start: patched.start?.dateTime || resolvedStart,
        end: patched.end?.dateTime || resolvedEnd,
      },
      timezone
    );
    const day = formatInTimeZone(parseISO(resolvedStart), timezone, 'yyyy-MM-dd');

    debug?.log({
      type: 'reschedule_execute',
      eventId: stableId,
      confirmed,
      success: true,
    });

    const stateUpdates: Partial<ConversationState> = state
      ? (() => {
          let next = upsertCachedEvent(
            state,
            stableId,
            summary,
            patched.start?.dateTime || resolvedStart,
            patched.end?.dateTime || resolvedEnd,
            timezone
          );
          next = setPendingReschedule(next, null);
          return {
            cachedCalendar: next.cachedCalendar,
            calendarVersion: next.calendarVersion,
            pendingReschedule: null,
            awaitingConfirmation: false,
            lastRescheduledEvent: {
              eventId: stableId,
              summary,
              start: patched.start?.dateTime || newStartTime,
              end: patched.end?.dateTime || newEndTime,
              display,
              day,
            },
          };
        })()
      : { awaitingConfirmation: false };

    return {
      result: {
        success: true,
        display,
        eventId: stableId,
        hint: 'Use this same eventId for any further reschedule of this meeting.',
      },
      stateUpdates,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Patch failed';
    debug?.log({
      type: 'reschedule_execute',
      eventId: stableId,
      confirmed,
      success: false,
      error: message,
    });
    return {
      result: {
        success: false,
        error: 'Could not reschedule the event. Call identify_event for the current time, then retry.',
        hint: 'Use eventId from list_events or lastRescheduledEvent in session.',
      },
      stateUpdates: {},
    };
  }
}
