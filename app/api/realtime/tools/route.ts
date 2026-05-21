import { NextRequest, NextResponse } from 'next/server';
import { getSession, saveSession, createInitialState } from '@/lib/session/store';
import { findFreeSlots } from '@/lib/calendar/slot-search';
import {
  initBookingJob,
  executeBookingBatch,
  getBookingProgress,
} from '@/lib/agent/booking-executor';
import { createEvent, deleteEvent, lookupEvent, listEvents } from '@/lib/calendar/events';
import { getTimeWindowBounds, formatTimeSlot } from '@/lib/calendar/utils';
import { executeFindFreeSlots } from '@/lib/agent/find-slots';
import { planMultiDayBookings } from '@/lib/agent/multi-booking';
import { runIdentifyEvent, runRescheduleEvent } from '@/lib/agent/event-matcher';
import { isSlotFree, filterFutureSlots } from '@/lib/calendar/slot-search';
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
      const { duration } = args;
      const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd');

      const dayStrs = [
        today,
        formatInTimeZone(addDays(now, 1), timezone, 'yyyy-MM-dd'),
        formatInTimeZone(addDays(now, 2), timezone, 'yyyy-MM-dd'),
      ];
      const allResults = await Promise.all(
        dayStrs.map(d => {
          const bounds = getTimeWindowBounds(d, 'anytime', timezone, now, workingHours);
          return findFreeSlots(bounds.start, bounds.end, duration, undefined, debug)
            .then(found => filterFutureSlots(found, now));
        })
      );

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
      const {
        duration,
        day,
        timeWindow,
        preferredStartTime,
        preferredEndTime,
      } = args;

      const searchResult = await executeFindFreeSlots(
        {
          duration,
          day,
          timeWindow,
          preferredStartTime,
          preferredEndTime,
        },
        timezone,
        debug,
        workingHours,
        now
      );

      state.slots = {
        ...state.slots,
        duration,
        day,
        timeWindow,
        preferredStart: preferredStartTime ?? state.slots.preferredStart,
        preferredEnd: preferredEndTime ?? state.slots.preferredEnd,
      };
      state.calendarResults = searchResult.slots;
      state.lastSearchParams = searchResult.searchParams;
      state.awaitingConfirmation =
        searchResult.slotsFound > 0 || searchResult.requestedSlot?.available === true;

      result = {
        slotsFound: searchResult.slotsFound,
        slots: searchResult.slots.map(s => ({
          start: s.start,
          end: s.end,
          display: formatTimeSlot(s, timezone),
        })),
        conflictStrategy: searchResult.conflictStrategy,
        conflictMessage: searchResult.conflictMessage,
        hint: searchResult.hint,
      };
      if (searchResult.blockingEvents) result.blockingEvents = searchResult.blockingEvents;
      if (searchResult.requestedSlot) result.requestedSlot = searchResult.requestedSlot;

    } else if (toolName === 'plan_multi_day_bookings') {
      const { durationMinutes, days, preferredTime } = args;
      const plan = await planMultiDayBookings(
        { durationMinutes, days, preferredTime, timezone, workingHours },
        debug,
        now
      );
      result = {
        ...plan,
        hint:
          plan.conflicts.length === 0
            ? 'All days available. Ask ONE confirmation, then init_booking_job with all autoBookable entries, then execute_booking_batch once. Never promise to notify later.'
            : 'Show ONLY conflict days. Do not list autoBookable days. After user picks, init_booking_job then execute_booking_batch.',
      };
      state.awaitingConfirmation = true;

    } else if (toolName === 'init_booking_job') {
      const { entries } = args;
      const { job, jobId, total, hint } = initBookingJob(entries ?? [], timezone);
      state.bookingJob = job;
      state.awaitingConfirmation = false;
      const progress = getBookingProgress(job);
      result = {
        jobId,
        total,
        progress,
        hint,
        startBookingRun: progress.pending > 0,
      };

    } else if (toolName === 'execute_booking_batch') {
      if (!state.bookingJob) {
        result = {
          error: 'No active booking job. Call init_booking_job first.',
        };
      } else {
        const batchSize = typeof args.batchSize === 'number' ? args.batchSize : 5;
        const batchResult = await executeBookingBatch(state.bookingJob, batchSize);
        state.bookingJob = batchResult.job;
        result = {
          progress: batchResult.progress,
          bookedThisBatch: batchResult.bookedThisBatch,
          failedThisBatch: batchResult.failedThisBatch,
          done: batchResult.done,
          hint: batchResult.hint,
          startBookingRun: batchResult.progress.pending > 0,
        };
      }

    } else if (toolName === 'identify_event') {
      const { timeMin, timeMax, timeHint, summaryHint, day } = args;
      result = await runIdentifyEvent(
        timeMin,
        timeMax,
        { timeHint, summaryHint, day },
        timezone
      );

    } else if (toolName === 'reschedule_event') {
      const { eventId, newStartTime, newEndTime, confirmed } = args;
      result = await runRescheduleEvent(
        eventId,
        newStartTime,
        newEndTime,
        confirmed,
        timezone
      );

    } else if (toolName === 'create_event') {
      const { summary, startTime, endTime, attendees = [], description } = args;

      const eventStart = new Date(startTime);
      if (eventStart < now) {
        result = {
          success: false,
          error: 'Cannot book a meeting in the past.',
          currentTime: formatInTimeZone(now, timezone, 'h:mm a'),
          hint: 'Use find_next_slot to get the soonest available slot.',
        };
      } else {
        const free = await isSlotFree(startTime, endTime);
        if (!free) {
          result = {
            success: false,
            error: 'That time conflicts with an existing event.',
            hint: 'Call find_free_slots with preferredStartTime for nearest alternatives.',
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

    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[realtime/tools] error:', msg);
    console.log(`[PERF][realtime/tools] total (error): ${Date.now() - t0}ms`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
