import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { v4 as uuidv4 } from 'uuid';
import { getSession, saveSession, createInitialState } from '@/lib/session/store';
import { buildSystemPrompt } from '@/lib/agent/prompt';
import { TOOL_SCHEMAS } from '@/lib/agent/tools';
import { extractAndUpdateSlots } from '@/lib/agent/slot-filler';
import {
  addMessage,
  setCalendarResults,
  setAwaitingConfirmation,
  setLastSearchParams,
  hasAllRequiredSlots,
} from '@/lib/agent/state';
import {
  initBookingJob,
  executeBookingBatch,
  getBookingProgress,
} from '@/lib/agent/booking-executor';
import {
  initCancelJob,
  executeCancelBatch,
  getCancelProgress,
  setLastBulkCancelTarget,
} from '@/lib/agent/cancel-executor';
import { tryReconcileCreateEventWithBookingJob } from '@/lib/agent/booking-context';
import { runIdentifyEvent, runRescheduleEvent } from '@/lib/agent/event-matcher';
import { invalidateEventCache, updateEventCache } from '@/lib/agent/event-cache';
import {
  createEvent,
  deleteEvent,
  lookupEvent,
  listEventsPaginated,
} from '@/lib/calendar/events';
import { formatTimeSlot } from '@/lib/calendar/utils';
import { executeFindFreeSlots } from '@/lib/agent/find-slots';
import { isMultiDayRangeMessage } from '@/lib/agent/booking-days';
import { planMultiDayBookings } from '@/lib/agent/multi-booking';
import {
  buildLastMultiDayPlan,
  buildPlanToolResult,
  buildShortPlanSummary,
  resolveInitEntries,
  stateUpdatesForNewPlan,
} from '@/lib/agent/multi-day-plan';
import { isSlotFree } from '@/lib/calendar/slot-search';
import { DebugLogger } from '@/lib/debug';
import { generateVoiceScript } from '@/lib/voice-script';
import {
  BookingProgressSnapshot,
  CancelProgressSnapshot,
  ConversationState,
  WorkingHours,
} from '@/types';
import { withCalendarAuth } from '@/lib/calendar/auth';
import { resolveCalendarAuth } from '@/lib/auth/resolve';

export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_TOOL_LOOPS = 8;
const MAX_HISTORY_TURNS = 30;

// ---------------------------------------------------------------------------
// Tool execution — returns the JSON result sent back to the LLM as a tool msg
// ---------------------------------------------------------------------------
async function executeTool(
  toolName: string,
  args: Record<string, any>,
  state: ConversationState,
  timezone: string,
  debug: DebugLogger,
  workingHours?: WorkingHours
): Promise<{ toolResult: Record<string, any>; stateUpdates: Partial<ConversationState> }> {
  const tExec = Date.now();
  debug.log({ type: 'tool_call', tool: toolName, args });

  // ── find_free_slots ────────────────────────────────────────────────────────
  if (toolName === 'find_free_slots') {
    const {
      duration,
      day,
      timeWindow,
      preferredStartTime,
      preferredEndTime,
    } = args as {
      duration: number;
      day: string;
      timeWindow: string;
      preferredStartTime?: string;
      preferredEndTime?: string;
    };

    const now = new Date();
    const result = await executeFindFreeSlots(
      {
        duration,
        day,
        timeWindow,
        preferredStartTime: preferredStartTime ?? state.slots.preferredStart ?? undefined,
        preferredEndTime: preferredEndTime ?? state.slots.preferredEnd ?? undefined,
      },
      timezone,
      debug,
      workingHours,
      now
    );

    const updatedSlots = {
      ...state.slots,
      duration,
      day,
      timeWindow,
      preferredStart: preferredStartTime ?? state.slots.preferredStart,
      preferredEnd: preferredEndTime ?? state.slots.preferredEnd,
    };

    const toolResult: Record<string, any> = {
      slotsFound: result.slotsFound,
      slots: result.slots.map(s => ({
        start: s.start,
        end: s.end,
        display: formatTimeSlot(s, timezone),
      })),
      conflictStrategy: result.conflictStrategy,
      conflictMessage: result.conflictMessage,
      searchParams: result.searchParams,
      hint: result.hint ?? null,
    };

    if (result.blockingEvents?.length) toolResult.blockingEvents = result.blockingEvents;
    if (result.requestedSlot) toolResult.requestedSlot = result.requestedSlot;

    console.log(`[PERF][chat] executeTool find_free_slots: ${Date.now() - tExec}ms`);
    return {
      toolResult,
      stateUpdates: {
        slots: updatedSlots,
        calendarResults: result.slots,
        lastSearchParams: result.searchParams,
        awaitingConfirmation: result.slotsFound > 0 || result.requestedSlot?.available === true,
      },
    };
  }

  // ── plan_multi_day_bookings ───────────────────────────────────────────────
  if (toolName === 'plan_multi_day_bookings') {
    const { durationMinutes, days, preferredTime, dayPattern, userMessage, summary } = args as {
      durationMinutes: number;
      days: string[];
      preferredTime: string;
      summary?: string;
      dayPattern?: {
        monthOffset?: number;
        weekdaysOnly?: boolean;
        week?: 'first' | 'last';
        month?: number;
        year?: number;
      };
      userMessage?: string;
    };

    const latestUser = [...state.conversationHistory]
      .reverse()
      .find(m => m.role === 'user');
    const resolvedUserMessage = userMessage ?? latestUser?.content;

    const plan = await planMultiDayBookings(
      {
        durationMinutes,
        days,
        preferredTime,
        timezone,
        workingHours,
        dayPattern,
        userMessage: resolvedUserMessage,
      },
      debug
    );

    const eventSummary = typeof summary === 'string' && summary.trim() ? summary.trim() : 'Meeting';
    const lastMultiDayPlan = buildLastMultiDayPlan(plan, preferredTime, eventSummary);
    const toolResult = buildPlanToolResult(plan);

    console.log(`[PERF][chat] executeTool plan_multi_day_bookings: ${Date.now() - tExec}ms`);
    return {
      toolResult,
      stateUpdates: {
        awaitingConfirmation: true,
        lastMultiDayPlan,
        ...stateUpdatesForNewPlan(state),
      },
    };
  }

  // ── init_booking_job ──────────────────────────────────────────────────────
  if (toolName === 'init_booking_job') {
    const { entries, force, summary } = args as {
      entries: Array<{ day: string; start: string; end: string; summary: string }>;
      force?: boolean;
      summary?: string;
    };

    const { entries: resolvedEntries, overridden } = resolveInitEntries(
      entries ?? [],
      state.lastMultiDayPlan
    );
    if (overridden) {
      debug.log({
        type: 'booking_job_init',
        jobId: state.bookingJob?.id ?? 'new',
        total: resolvedEntries.length,
        days: resolvedEntries.map(e => e.day),
        overriddenFromPlan: true,
        llmEntryCount: entries?.length ?? 0,
      });
    }

    const initResult = await initBookingJob(
      resolvedEntries,
      timezone,
      state.bookingJob,
      force
    );

    if ('error' in initResult) {
      debug.log({
        type: 'booking_job_init',
        jobId: state.bookingJob?.id ?? 'blocked',
        total: resolvedEntries.length,
        days: resolvedEntries.map(e => e.day),
        blocked: true,
        reason: initResult.message,
      });
      console.log(`[PERF][chat] executeTool init_booking_job (blocked): ${Date.now() - tExec}ms`);
      return {
        toolResult: {
          error: initResult.error,
          message: initResult.message,
          progress: initResult.progress,
          hint: 'Booking already completed. Do not re-initialize. Tell the user all meetings are booked.',
          startBookingRun: false,
        },
        stateUpdates: {},
      };
    }

    const { job, jobId, total, hint } = initResult;
    const progress = getBookingProgress(job);
    const planSummary = state.lastMultiDayPlan
      ? buildShortPlanSummary(state.lastMultiDayPlan)
      : `${total} meeting(s)${summary ? ` — ${summary}` : ''}`;

    debug.log({
      type: 'booking_job_init',
      jobId,
      total,
      days: resolvedEntries.map(e => e.day),
      overriddenFromPlan: overridden,
    });

    console.log(`[PERF][chat] executeTool init_booking_job: ${Date.now() - tExec}ms`);
    return {
      toolResult: {
        jobId,
        total,
        progress,
        hint: overridden
          ? `${hint} Server expanded to ${total} day(s) from the confirmed plan.`
          : hint,
        startBookingRun: progress.pending > 0,
        entriesOverridden: overridden,
      },
      stateUpdates: {
        bookingJob: job,
        awaitingConfirmation: false,
        bookingPlanConfirmed: true,
        confirmedPlanSummary: planSummary,
        lastMultiDayPlan: null,
      },
    };
  }

  // ── execute_booking_batch ─────────────────────────────────────────────────
  if (toolName === 'execute_booking_batch') {
    if (!state.bookingJob) {
      return {
        toolResult: {
          error: 'No active booking job. Call init_booking_job first.',
          hint: 'Use plan_multi_day_bookings, confirm with user, then init_booking_job.',
        },
        stateUpdates: {},
      };
    }

    const existingProgress = getBookingProgress(state.bookingJob);
    if (
      state.bookingJob.status === 'completed' ||
      (existingProgress.booked > 0 && existingProgress.pending === 0)
    ) {
      return {
        toolResult: {
          error: 'job_already_done',
          message: 'Booking job already finished.',
          progress: existingProgress,
          done: true,
          hint: 'All meetings are booked. Do not call execute_booking_batch again.',
          startBookingRun: false,
        },
        stateUpdates: {},
      };
    }

    const batchSize = typeof args.batchSize === 'number' ? args.batchSize : 5;
    const result = await executeBookingBatch(state.bookingJob, batchSize, debug);

    console.log(`[PERF][chat] executeTool execute_booking_batch: ${Date.now() - tExec}ms`);
    return {
      toolResult: {
        progress: result.progress,
        bookedThisBatch: result.bookedThisBatch,
        failedThisBatch: result.failedThisBatch,
        reconciledThisBatch: result.reconciledThisBatch,
        done: result.done,
        hint: result.hint,
        startBookingRun: !result.done && result.progress.pending > 0,
        failedDetails: result.failedDetails.length > 0 ? result.failedDetails : undefined,
      },
      stateUpdates: { bookingJob: result.job },
    };
  }

  // ── init_cancel_job ───────────────────────────────────────────────────────
  if (toolName === 'init_cancel_job') {
    const { eventIds, force, summary } = args as {
      eventIds: string[];
      force?: boolean;
      summary?: string;
    };

    const initResult = await initCancelJob(
      eventIds ?? [],
      state,
      timezone,
      state.cancelJob,
      force
    );

    if ('error' in initResult) {
      return {
        toolResult: {
          error: initResult.error,
          message: initResult.message,
          progress: initResult.progress,
          hint: 'Cancellation already completed. Do not re-initialize.',
          startCancelRun: false,
        },
        stateUpdates: {},
      };
    }

    const { job, jobId, total, hint } = initResult;
    const progress = getCancelProgress(job);
    const cancelSummary =
      state.lastBulkCancelTarget?.summary ??
      `${total} event(s)${summary ? ` — ${summary}` : ''}`;

    return {
      toolResult: {
        jobId,
        total,
        progress,
        hint,
        startCancelRun: progress.pending > 0,
      },
      stateUpdates: {
        cancelJob: job,
        cancelPlanConfirmed: true,
        confirmedCancelSummary: cancelSummary,
        awaitingConfirmation: false,
      },
    };
  }

  // ── execute_cancel_batch ──────────────────────────────────────────────────
  if (toolName === 'execute_cancel_batch') {
    if (!state.cancelJob) {
      return {
        toolResult: {
          error: 'No active cancel job. Call init_cancel_job first.',
        },
        stateUpdates: {},
      };
    }

    const existingProgress = getCancelProgress(state.cancelJob);
    if (
      state.cancelJob.status === 'completed' ||
      (existingProgress.cancelled > 0 && existingProgress.pending === 0)
    ) {
      return {
        toolResult: {
          error: 'job_already_done',
          message: 'Cancel job already finished.',
          progress: existingProgress,
          done: true,
          startCancelRun: false,
        },
        stateUpdates: {},
      };
    }

    const batchSize = typeof args.batchSize === 'number' ? args.batchSize : 5;
    const result = await executeCancelBatch(state.cancelJob, batchSize, debug);

    return {
      toolResult: {
        progress: result.progress,
        cancelledThisBatch: result.cancelledThisBatch,
        failedThisBatch: result.failedThisBatch,
        done: result.done,
        hint: result.hint,
        startCancelRun: !result.done && result.progress.pending > 0,
        failedDetails: result.failedDetails.length > 0 ? result.failedDetails : undefined,
      },
      stateUpdates: { cancelJob: result.job },
    };
  }

  // ── identify_event ────────────────────────────────────────────────────────
  if (toolName === 'identify_event') {
    const { timeMin, timeMax, timeHint, summaryHint, day } = args as {
      timeMin: string;
      timeMax: string;
      timeHint?: string;
      summaryHint?: string;
      day?: string;
    };
    const { result, stateUpdates } = await runIdentifyEvent(
      timeMin,
      timeMax,
      { timeHint, summaryHint, day },
      timezone,
      state,
      debug
    );
    console.log(`[PERF][chat] executeTool identify_event: ${Date.now() - tExec}ms`);
    return { toolResult: result, stateUpdates };
  }

  // ── reschedule_event ──────────────────────────────────────────────────────
  if (toolName === 'reschedule_event') {
    const { eventId, newStartTime, newEndTime, confirmed } = args as {
      eventId: string;
      newStartTime: string;
      newEndTime: string;
      confirmed: boolean;
    };
    const { result, stateUpdates } = await runRescheduleEvent(
      eventId,
      newStartTime,
      newEndTime,
      confirmed,
      timezone,
      state,
      debug
    );
    console.log(`[PERF][chat] executeTool reschedule_event: ${Date.now() - tExec}ms`);
    return { toolResult: result, stateUpdates };
  }

  // ── create_event ──────────────────────────────────────────────────────────
  if (toolName === 'create_event') {
    const { summary, startTime, endTime, attendees = [], description } = args as {
      summary: string;
      startTime: string;
      endTime: string;
      attendees?: string[];
      description?: string;
    };

    const reconciled = tryReconcileCreateEventWithBookingJob(
      state,
      startTime,
      endTime,
      summary
    );
    if (reconciled) {
      console.log(`[PERF][chat] executeTool create_event (already booked): ${Date.now() - tExec}ms`);
      return {
        toolResult: reconciled,
        stateUpdates: {},
      };
    }

    const free = await isSlotFree(startTime, endTime);
    if (!free) {
      const conflictReconcile = tryReconcileCreateEventWithBookingJob(
        state,
        startTime,
        endTime,
        summary
      );
      if (conflictReconcile) {
        return { toolResult: conflictReconcile, stateUpdates: {} };
      }
      return {
        toolResult: {
          success: false,
          error: 'That time is no longer available — it conflicts with an existing event.',
          hint: 'Call find_free_slots again with the same preferred time for proximity-ranked alternatives.',
        },
        stateUpdates: {},
      };
    }

    const event = await createEvent(summary, startTime, endTime, attendees, description);

    debug.log({ type: 'tool_result', tool: 'create_event', summary: `created eventId=${event.id}` });

    console.log(`[PERF][chat] executeTool create_event: ${Date.now() - tExec}ms`);
    const invalidated = invalidateEventCache(state);
    return {
      toolResult: {
        success: true,
        eventId: event.id,
        summary: event.summary,
        start: event.start.dateTime,
        end: event.end.dateTime,
      },
      stateUpdates: {
        awaitingConfirmation: false,
        calendarResults: [],
        lastSearchParams: null,
        cachedCalendar: invalidated.cachedCalendar,
        calendarVersion: invalidated.calendarVersion,
        pendingReschedule: invalidated.pendingReschedule,
      },
    };
  }

  // ── list_events ───────────────────────────────────────────────────────────
  if (toolName === 'list_events') {
    const { timeMin, timeMax } = args as { timeMin: string; timeMax: string };
    const events = await listEventsPaginated(timeMin, timeMax, undefined, debug);

    debug.log({
      type: 'tool_result',
      tool: 'list_events',
      summary: `${events.length} event(s) in range ${timeMin} → ${timeMax}`,
    });

    const toolResult = {
      count: events.length,
      events: events.map(e => ({
        id: e.id,
        summary: e.summary ?? '(no title)',
        start: e.start?.dateTime,
        end:   e.end?.dateTime,
        display: e.start?.dateTime && e.end?.dateTime
          ? formatTimeSlot({ start: e.start.dateTime, end: e.end.dateTime }, timezone)
          : 'All day',
        attendees: (e.attendees ?? []).map((a: { email: string }) => a.email),
      })),
    };

    const cached = updateEventCache(state, timeMin, timeMax, events, timezone);
    const withTarget = setLastBulkCancelTarget(cached, timeMin, timeMax, cached.cachedCalendar!.events);
    console.log(`[PERF][chat] executeTool list_events: ${Date.now() - tExec}ms`);
    return {
      toolResult: {
        ...toolResult,
        hint:
          events.length > 7
            ? `${events.length} events found. For bulk cancel, confirm count with user then init_cancel_job — do not list every title.`
            : undefined,
      },
      stateUpdates: {
        cachedCalendar: withTarget.cachedCalendar,
        calendarVersion: state.calendarVersion,
        lastBulkCancelTarget: withTarget.lastBulkCancelTarget,
      },
    };
  }

  // ── lookup_event ──────────────────────────────────────────────────────────
  if (toolName === 'lookup_event') {
    const { query } = args as { query: string };
    const event = await lookupEvent(query);

    debug.log({
      type: 'tool_result',
      tool: 'lookup_event',
      summary: event ? `found "${event.summary}" on ${event.start.dateTime}` : 'not found',
    });

    console.log(`[PERF][chat] executeTool lookup_event: ${Date.now() - tExec}ms`);
    return {
      toolResult: event
        ? { found: true, id: event.id, summary: event.summary, start: event.start.dateTime, end: event.end.dateTime }
        : { found: false },
      stateUpdates: {},
    };
  }

  // ── delete_event ──────────────────────────────────────────────────────────
  if (toolName === 'delete_event') {
    const { eventId, eventSummary } = args as { eventId: string; eventSummary?: string };
    try {
      await deleteEvent(eventId);
      const label = eventSummary || eventId;
      debug.log({ type: 'tool_result', tool: 'delete_event', summary: `deleted ${label}` });
      console.log(`[PERF][chat] executeTool delete_event: ${Date.now() - tExec}ms`);
      const invalidated = invalidateEventCache(state);
      return {
        toolResult: {
          success: true,
          deletedEventId: eventId,
          message: `Successfully deleted "${label}". The event has been removed from the calendar.`,
        },
        stateUpdates: {
          cachedCalendar: invalidated.cachedCalendar,
          calendarVersion: invalidated.calendarVersion,
          pendingReschedule: invalidated.pendingReschedule,
        },
      };
    } catch {
      console.log(`[PERF][chat] executeTool delete_event (not found): ${Date.now() - tExec}ms`);
      return {
        toolResult: {
          success: false,
          error: `Failed to delete event (${eventId}). The event was not found or was already deleted.`,
        },
        stateUpdates: {},
      };
    }
  }

  console.log(`[PERF][chat] executeTool unknown: ${toolName}`);
  throw new Error(`Unknown tool: ${toolName}`);
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const debug = new DebugLogger();

  try {
    const { message, sessionId: providedSessionId, timezone = 'UTC', workingHours } = await req.json();

    const userAuth = await resolveCalendarAuth();
    const runWithAuth = <T>(fn: () => Promise<T>) =>
      userAuth ? withCalendarAuth(userAuth, fn) : fn();

    return await runWithAuth(async () => {

    const sessionId = providedSessionId || uuidv4();
    let state = (await getSession(sessionId)) ?? createInitialState(sessionId);
    console.log(`[PERF][chat] session load: ${Date.now() - t0}ms`);

    // 1. Rule-based slot extraction (updates + stale detection)
    const tSlotExtract = Date.now();
    state = extractAndUpdateSlots(message, state, debug);
    console.log(`[PERF][chat] slot extraction: ${Date.now() - tSlotExtract}ms`);

    // 2. Add user message to history
    state = addMessage(state, 'user', message);

    // 3. Auto-search: if all slots are filled and no fresh results exist, run find_free_slots
    //    immediately (saves an LLM round-trip — the LLM was going to call it anyway).
    const needsAutoSearch =
      hasAllRequiredSlots(state) &&
      state.calendarResults.length === 0 &&
      !isMultiDayRangeMessage(message);
    if (needsAutoSearch) {
      const tAutoSearch = Date.now();
      debug.log({ type: 'tool_call', tool: 'find_free_slots', args: { duration: state.slots.duration, day: state.slots.day, timeWindow: state.slots.timeWindow } });
      const { toolResult, stateUpdates } = await executeTool(
        'find_free_slots',
        {
          duration: state.slots.duration!,
          day: state.slots.day!,
          timeWindow: state.slots.timeWindow!,
          preferredStartTime: state.slots.preferredStart ?? undefined,
          preferredEndTime: state.slots.preferredEnd ?? undefined,
        },
        state,
        timezone,
        debug,
        workingHours
      );
      state = { ...state, ...stateUpdates } as ConversationState;
      if (stateUpdates.slots) state.slots = stateUpdates.slots as typeof state.slots;
      console.log(`[PERF][chat] auto-search: ${Date.now() - tAutoSearch}ms`);
    }

    // 4. Build messages for the LLM (trim history to last N turns to save tokens)
    const history = state.conversationHistory
      .slice(-(MAX_HISTORY_TURNS * 2))
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    if (workingHours) {
      state.workingHours = workingHours;
    }

    const chatMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(state, timezone, workingHours) },
      ...history,
    ];

    // 5. Agentic tool loop
    let loopCount = 0;
    let finalText = '';
    let lastListedEvents: Array<{ id: string; summary: string; display: string }> | null = null;
    let bookingProgress: BookingProgressSnapshot | undefined;
    let cancelProgress: CancelProgressSnapshot | undefined;
    let startBookingRun = false;
    let startCancelRun = false;
    let batchFinishedJob = false;
    let cancelBatchFinished = false;
    const tLoop = Date.now();

    while (loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      debug.log({
        type: 'llm_call',
        model: 'gpt-4o-mini',
        messageCount: chatMessages.length,
        toolsEnabled: true,
      });

      const tLLM = Date.now();
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatMessages,
        tools: TOOL_SCHEMAS,
        temperature: 0.1,
      });

      const assistantMsg = completion.choices[0].message;
      const toolCalls = assistantMsg.tool_calls ?? [];
      console.log(`[PERF][chat] LLM call #${loopCount}: ${Date.now() - tLLM}ms`);

      debug.log({
        type: 'llm_response',
        hasToolCalls: toolCalls.length > 0,
        toolNames: toolCalls.map(tc => tc.function.name),
        textPreview: assistantMsg.content ?? undefined,
      });

      if (toolCalls.length === 0) {
        // LLM finished — no more tool calls
        finalText = assistantMsg.content ?? '';
        break;
      }

      // Push the assistant message (with tool_calls) into chat history
      chatMessages.push(assistantMsg as ChatCompletionMessageParam);

      // Execute each tool call and push results
      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        const args = JSON.parse(tc.function.arguments) as Record<string, any>;

        const { toolResult, stateUpdates } = await executeTool(
          toolName,
          args,
          state,
          timezone,
          debug,
          workingHours
        );

        // Apply state updates
        state = { ...state, ...stateUpdates } as ConversationState;
        if (stateUpdates.slots) state.slots = stateUpdates.slots as typeof state.slots;
        if (toolName === 'list_events' && toolResult.events?.length) {
          lastListedEvents = toolResult.events.map((e: any) => ({
            id: e.id, summary: e.summary, display: e.display,
          }));
        }
        if (toolName === 'init_booking_job' && toolResult.progress && !toolResult.error) {
          bookingProgress = toolResult.progress as BookingProgressSnapshot;
          startBookingRun = bookingProgress.pending > 0;
        }
        if (toolName === 'execute_booking_batch' && toolResult.progress) {
          bookingProgress = toolResult.progress as BookingProgressSnapshot;
          batchFinishedJob = Boolean(toolResult.done);
          startBookingRun = !batchFinishedJob && bookingProgress.pending > 0;
        }
        if (toolName === 'init_cancel_job' && toolResult.progress && !toolResult.error) {
          cancelProgress = toolResult.progress as CancelProgressSnapshot;
          startCancelRun = cancelProgress.pending > 0;
        }
        if (toolName === 'execute_cancel_batch' && toolResult.progress) {
          cancelProgress = toolResult.progress as CancelProgressSnapshot;
          cancelBatchFinished = Boolean(toolResult.done);
          startCancelRun = !cancelBatchFinished && cancelProgress.pending > 0;
        }
        if (state.bookingJob && !bookingProgress) {
          bookingProgress = getBookingProgress(state.bookingJob);
        }
        if (state.cancelJob && !cancelProgress) {
          cancelProgress = getCancelProgress(state.cancelJob);
        }

        chatMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });
      }
      // Loop back to let the LLM formulate a response based on tool results
    }
    console.log(`[PERF][chat] agentic loop (${loopCount} iterations): ${Date.now() - tLoop}ms`);

    if (!finalText) {
      finalText = 'Sorry, I had trouble processing that. Could you try again?';
    }

    // Extract VOICE: tag the LLM embeds in its response
    const voiceMatch  = finalText.match(/\nVOICE:\s*(.+)$/m);
    const voiceScript = voiceMatch
      ? voiceMatch[1].trim()
      : generateVoiceScript(finalText); // rule-based fallback

    // Strip the VOICE: line from the displayed message
    const displayText = finalText.replace(/\n?VOICE:\s*.+$/m, '').trim();

    debug.log({ type: 'final_response', textLength: displayText.length });

    // 5. Persist
    state = addMessage(state, 'assistant', displayText);
    const tSave = Date.now();
    await saveSession(state);
    console.log(`[PERF][chat] session save: ${Date.now() - tSave}ms`);

    const formattedSlots = state.calendarResults.length > 0
      ? state.calendarResults.slice(0, 5).map(s => ({
          start: s.start,
          end: s.end,
          display: formatTimeSlot(s, timezone),
        }))
      : undefined;

    if (state.bookingJob) {
      bookingProgress = getBookingProgress(state.bookingJob);
      if (batchFinishedJob || bookingProgress.pending === 0) {
        startBookingRun = false;
      }
    }
    if (state.cancelJob) {
      cancelProgress = getCancelProgress(state.cancelJob);
      if (cancelBatchFinished || cancelProgress.pending === 0) {
        startCancelRun = false;
      }
    }

    console.log(`[PERF][chat] total request: ${Date.now() - t0}ms`);
    return NextResponse.json({
      message: displayText,
      voiceScript,
      sessionId,
      slots: formattedSlots,
      events: lastListedEvents || undefined,
      bookingJob: bookingProgress,
      cancelJob: cancelProgress,
      startBookingRun: startBookingRun || undefined,
      startCancelRun: startCancelRun || undefined,
      state: {
        slots: state.slots,
        hasAllSlots: hasAllRequiredSlots(state),
        awaitingConfirmation: state.awaitingConfirmation,
        slotsFound: state.calendarResults.length,
      },
      debug: debug.summary(),
    });

    }); // end runWithAuth
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SCHEDULER:error]', message);
    console.log(`[PERF][chat] total request (error): ${Date.now() - t0}ms`);
    return NextResponse.json({ error: 'Failed to process message', detail: message }, { status: 500 });
  }
}
