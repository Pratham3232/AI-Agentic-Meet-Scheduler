import {
  ConversationState,
  CalendarEvent,
  CachedCalendarSnapshot,
  PendingReschedule,
  LastRescheduledEvent,
} from '@/types';
import { formatTimeSlot } from '@/lib/calendar/utils';

export type { CachedCalendarSnapshot, PendingReschedule };

function rangeContains(
  cacheMin: string,
  cacheMax: string,
  queryMin: string,
  queryMax: string
): boolean {
  return cacheMin <= queryMin && cacheMax >= queryMax;
}

export function updateEventCache(
  state: ConversationState,
  timeMin: string,
  timeMax: string,
  events: CalendarEvent[],
  timezone: string
): ConversationState {
  const rows = events
    .filter(e => e.start?.dateTime && e.end?.dateTime)
    .map(e => ({
      id: e.id,
      summary: e.summary ?? '(no title)',
      start: e.start!.dateTime!,
      end: e.end!.dateTime!,
      display: formatTimeSlot(
        { start: e.start!.dateTime!, end: e.end!.dateTime! },
        timezone
      ),
    }));

  return {
    ...state,
    cachedCalendar: {
      timeMin,
      timeMax,
      fetchedAt: new Date().toISOString(),
      events: rows,
    },
  };
}

export function shouldBypassEventCache(state: ConversationState): boolean {
  if (state.pendingReschedule) return true;
  if (state.lastRescheduledEvent) return true;
  return false;
}

export function getCachedEventsForRange(
  state: ConversationState,
  timeMin: string,
  timeMax: string
): CachedCalendarSnapshot['events'] | null {
  if (shouldBypassEventCache(state)) return null;
  const cache = state.cachedCalendar;
  if (!cache) return null;
  if (!rangeContains(cache.timeMin, cache.timeMax, timeMin, timeMax)) return null;
  return cache.events.filter(e => e.start >= timeMin && e.start < timeMax);
}

export function upsertCachedEvent(
  state: ConversationState,
  eventId: string,
  summary: string,
  start: string,
  end: string,
  timezone: string
): ConversationState {
  const display = formatTimeSlot({ start, end }, timezone);
  const row = { id: eventId, summary, start, end, display };

  if (!state.cachedCalendar) {
    return {
      ...state,
      cachedCalendar: {
        timeMin: start,
        timeMax: end,
        fetchedAt: new Date().toISOString(),
        events: [row],
      },
      calendarVersion: (state.calendarVersion ?? 0) + 1,
    };
  }

  const events = [...state.cachedCalendar.events];
  const idx = events.findIndex(e => e.id === eventId);
  if (idx >= 0) events[idx] = row;
  else events.push(row);

  return {
    ...state,
    cachedCalendar: {
      ...state.cachedCalendar,
      events,
      fetchedAt: new Date().toISOString(),
    },
    calendarVersion: (state.calendarVersion ?? 0) + 1,
  };
}

export function invalidateEventCache(state: ConversationState): ConversationState {
  return {
    ...state,
    cachedCalendar: null,
    calendarVersion: (state.calendarVersion ?? 0) + 1,
    pendingReschedule: null,
  };
}

export function findCachedEventById(
  state: ConversationState,
  eventId: string
): CachedCalendarSnapshot['events'][number] | undefined {
  return state.cachedCalendar?.events.find(e => e.id === eventId);
}

export function setPendingReschedule(
  state: ConversationState,
  pending: PendingReschedule | null
): ConversationState {
  return { ...state, pendingReschedule: pending };
}

export function buildCachedCalendarPromptBlock(state: ConversationState): string {
  const cache = state.cachedCalendar;
  if (!cache?.events.length) return '';

  const lines = cache.events.slice(0, 25).map((e, i) => `  ${i + 1}. [${e.id}] ${e.summary} — ${e.display}`);
  return `
## Cached calendar (${cache.timeMin.slice(0, 10)} → ${cache.timeMax.slice(0, 10)}, v${state.calendarVersion})
Use these event IDs for identify_event / reschedule_event — do NOT re-list a wide range unless the user asks for a different day.
${lines.join('\n')}`;
}

export function buildLastRescheduledBlock(state: ConversationState): string {
  const last = state.lastRescheduledEvent;
  if (!last) return '';
  return `
## Last rescheduled event (use this eventId for further moves on the same meeting)
eventId: ${last.eventId}
${last.summary} — ${last.display}
Day: ${last.day}`;
}

export function buildPendingRescheduleBlock(state: ConversationState): string {
  const p = state.pendingReschedule;
  if (!p) return '';
  return `
## Pending reschedule (awaiting user confirmation)
Event: ${p.summary} (${p.oldDisplay})
eventId: ${p.eventId}
${p.newDisplay ? `Proposed: ${p.newDisplay}` : 'Call reschedule_event with new times after user confirms.'}`;
}
