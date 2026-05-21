import { NextRequest, NextResponse } from 'next/server';
import { getSession, saveSession, createInitialState } from '@/lib/session/store';
import { findFreeSlots } from '@/lib/calendar/freebusy';
import { createEvent, deleteEvent, lookupEvent, listEvents } from '@/lib/calendar/events';
import { getTimeWindowBounds, formatTimeSlot } from '@/lib/calendar/utils';
import { resolveConflict } from '@/lib/agent/conflict-resolver';
import { DebugLogger } from '@/lib/debug';
import { v4 as uuidv4 } from 'uuid';
import { addDays, format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { withCalendarAuth } from '@/lib/calendar/auth';
import { resolveCalendarAuth } from '@/lib/auth/resolve';

export const maxDuration = 15;

/**
 * POST /api/realtime/tools
 * Executes tool calls from the Realtime API.
 * All time validation happens HERE so the LLM doesn't need to reason about it.
 */
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const debug = new DebugLogger();

  try {
    const { toolName, args, sessionId: providedSessionId, timezone = 'UTC', workingHours } = await req.json();
    const now = new Date();

    const userAuth = await resolveCalendarAuth();
    const runWithAuth = <T>(fn: () => Promise<T>) =>
      userAuth ? withCalendarAuth(userAuth, fn) : fn();

    return await runWithAuth(async () => {

    const sessionId = providedSessionId || uuidv4();
    let state = (await getSession(sessionId)) ?? createInitialState(sessionId);

    debug.log({ type: 'tool_call', tool: toolName, args });

    let result: Record<string, any> = {};
    const tTool = Date.now();

    if (toolName === 'find_next_slot') {
      // ASAP booking: find the soonest available slot starting from NOW
      const { duration } = args;
      const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');

      // Query up to 3 days in parallel to minimise latency
      const dayStrs = [
        today,
        format(addDays(now, 1), 'yyyy-MM-dd'),
        format(addDays(now, 2), 'yyyy-MM-dd'),
      ];
      const allResults = await Promise.all(
        dayStrs.map(d => {
          const bounds = getTimeWindowBounds(d, 'anytime', timezone, now, workingHours);
          return findFreeSlots(bounds.start, bounds.end, duration, undefined, debug)
            .then(found => found.filter(s => new Date(s.start) >= now));
        })
      );

      // Pick the earliest day with available slots (preserve day ordering)
      let slots: any[] = [];
      for (const found of allResults) {
        if (found.length > 0) { slots = found; break; }
      }

      state.slots = { ...state.slots, duration, day: today, timeWindow: 'anytime' };
      state.calendarResults = slots;
      state.awaitingConfirmation = slots.length > 0;

      result.slotsFound = slots.length;
      result.slots = slots.slice(0, 5).map(s => ({
        start: s.start,
        end: s.end,
        display: formatTimeSlot(s, timezone),
      }));
      if (slots.length > 0) {
        result.earliest = result.slots[0].display;
        result.hint = 'Present these slots to the user. The first one is the soonest available.';
      } else {
        result.hint = 'No slots found in the next 3 days. Ask user for a different time range.';
      }

    } else if (toolName === 'find_free_slots') {
      const { duration, day, timeWindow } = args;
      const bounds = getTimeWindowBounds(day, timeWindow, timezone, now, workingHours);

      let slots = (await findFreeSlots(bounds.start, bounds.end, duration, undefined, debug))
        .filter(s => new Date(s.start) >= now);

      if (slots.length === 0) {
        const existingEvents = await listEvents(bounds.start, bounds.end, undefined, debug);
        result.blockingEvents = existingEvents
          .filter(e => e.start?.dateTime && e.end?.dateTime)
          .map(e => ({
            summary: e.summary ?? '(no title)',
            start: e.start.dateTime,
            end: e.end.dateTime,
            display: formatTimeSlot({ start: e.start.dateTime!, end: e.end.dateTime! }, timezone),
          }));

        const conflict = await resolveConflict({ duration, day, timeWindow }, debug, timezone, workingHours);
        slots = conflict.slots.filter(s => new Date(s.start) >= now);
        result.conflictStrategy = conflict.strategy;
        result.conflictMessage = conflict.message;
      }

      state.slots = { ...state.slots, duration, day, timeWindow };
      state.calendarResults = slots;
      state.lastSearchParams = { duration, day, timeWindow };
      state.awaitingConfirmation = slots.length > 0;

      result.slotsFound = slots.length;
      result.slots = slots.slice(0, 5).map(s => ({
        start: s.start,
        end: s.end,
        display: formatTimeSlot(s, timezone),
      }));

    } else if (toolName === 'create_event') {
      const { summary, startTime, endTime, attendees = [], description } = args;

      // VALIDATION: Reject booking in the past
      const eventStart = new Date(startTime);
      if (eventStart < now) {
        result = {
          success: false,
          error: 'Cannot book a meeting in the past.',
          currentTime: formatInTimeZone(now, timezone, 'h:mm a'),
          hint: 'The requested time has already passed. Use find_next_slot to get the soonest available slot.',
        };
      } else {
        const event = await createEvent(summary, startTime, endTime, attendees, description);
        state.awaitingConfirmation = false;
        state.calendarResults = [];
        state.lastSearchParams = null;
        result = {
          success: true,
          eventId: event.id,
          summary: event.summary,
          start: event.start.dateTime,
          end: event.end.dateTime,
          displayTime: formatTimeSlot({ start: event.start.dateTime || '', end: event.end.dateTime || '' }, timezone),
        };
      }

    } else if (toolName === 'list_events') {
      const { timeMin, timeMax } = args;
      const events = await listEvents(timeMin, timeMax, undefined, debug);
      result = {
        count: events.length,
        events: events.map(e => ({
          id: e.id,
          summary: e.summary ?? '(no title)',
          start: e.start?.dateTime,
          end: e.end?.dateTime,
          display: e.start?.dateTime && e.end?.dateTime
            ? formatTimeSlot({ start: e.start.dateTime, end: e.end.dateTime }, timezone)
            : 'All day',
        })),
      };

    } else if (toolName === 'lookup_event') {
      const { query } = args;
      const event = await lookupEvent(query);
      result = event
        ? { found: true, id: event.id, summary: event.summary, start: event.start.dateTime, end: event.end.dateTime }
        : { found: false };

    } else if (toolName === 'delete_event') {
      const { eventId } = args;
      try {
        await deleteEvent(eventId);
        result = { success: true, deletedEventId: eventId };
      } catch {
        result = { success: false, error: 'Event not found or already deleted.' };
      }

    } else {
      return NextResponse.json({ error: `Unknown tool: ${toolName}` }, { status: 400 });
    }

    console.log(`[PERF][realtime/tools] tool=${toolName}: ${Date.now() - tTool}ms`);

    await saveSession(state);
    console.log(`[PERF][realtime/tools] total (${toolName}): ${Date.now() - t0}ms`);
    return NextResponse.json({ result, sessionId });

    }); // end runWithAuth
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[realtime/tools] error:', msg);
    console.log(`[PERF][realtime/tools] total (error): ${Date.now() - t0}ms`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
