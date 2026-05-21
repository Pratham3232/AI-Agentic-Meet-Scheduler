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
  updateSlot,
} from '@/lib/agent/state';
import { findFreeSlots } from '@/lib/calendar/freebusy';
import { createEvent, deleteEvent, lookupEvent, listEvents } from '@/lib/calendar/events';
import { getTimeWindowBounds, formatSlotList, formatTimeSlot } from '@/lib/calendar/utils';
import { resolveConflict } from '@/lib/agent/conflict-resolver';
import { DebugLogger } from '@/lib/debug';
import { generateVoiceScript } from '@/lib/voice-script';
import { ConversationState, WorkingHours } from '@/types';
import { withCalendarAuth } from '@/lib/calendar/auth';
import { resolveCalendarAuth } from '@/lib/auth/resolve';

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
    const { duration, day, timeWindow } = args as {
      duration: number;
      day: string;
      timeWindow: string;
    };

    const bounds = getTimeWindowBounds(day, timeWindow, timezone, undefined, workingHours);

    debug.log({
      type: 'calendar_query',
      startTime: bounds.start,
      endTime: bounds.end,
      duration,
      timezone,
    });

    let slots = await findFreeSlots(bounds.start, bounds.end, duration, undefined, debug);
    let conflictStrategy: string | null = null;
    let conflictMessage = '';
    let blockingEvents: Array<{ summary: string; start: string; end: string; display: string }> = [];

    if (slots.length === 0) {
      // Fetch the events that are blocking this window so the LLM can show them
      const existingEvents = await listEvents(bounds.start, bounds.end, undefined, debug);
      blockingEvents = existingEvents
        .filter(e => e.start?.dateTime && e.end?.dateTime)
        .map(e => ({
          summary: e.summary ?? '(no title)',
          start: e.start.dateTime!,
          end: e.end.dateTime!,
          display: formatTimeSlot({ start: e.start.dateTime!, end: e.end.dateTime! }, timezone),
        }));

      const conflict = await resolveConflict({ duration, day, timeWindow }, debug, timezone, workingHours);
      slots = conflict.slots;
      conflictStrategy = conflict.strategy;
      conflictMessage = conflict.message;
    }

    const updatedSlots = {
      ...state.slots,
      duration,
      day,
      timeWindow,
    };

    debug.log({
      type: 'tool_result',
      tool: 'find_free_slots',
      summary: `${slots.length} slot(s) found, strategy=${conflictStrategy ?? 'direct'}, blocking=${blockingEvents.length}`,
    });

    const toolResult: Record<string, any> = {
      slotsFound: slots.length,
      slots: slots.slice(0, 5).map(s => ({
        start: s.start,
        end: s.end,
        display: formatTimeSlot(s, timezone),
      })),
      conflictStrategy,
      conflictMessage: conflictMessage || null,
      searchParams: { duration, day, timeWindow },
    };

    if (blockingEvents.length > 0) {
      toolResult.blockingEvents = blockingEvents;
    }

    console.log(`[PERF][chat] executeTool find_free_slots: ${Date.now() - tExec}ms`);
    return {
      toolResult,
      stateUpdates: {
        slots: updatedSlots,
        calendarResults: slots,
        lastSearchParams: { duration, day, timeWindow },
        awaitingConfirmation: slots.length > 0,
      },
    };
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

    const event = await createEvent(summary, startTime, endTime, attendees, description);

    debug.log({ type: 'tool_result', tool: 'create_event', summary: `created eventId=${event.id}` });

    console.log(`[PERF][chat] executeTool create_event: ${Date.now() - tExec}ms`);
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
      },
    };
  }

  // ── list_events ───────────────────────────────────────────────────────────
  if (toolName === 'list_events') {
    const { timeMin, timeMax } = args as { timeMin: string; timeMax: string };
    const events = await listEvents(timeMin, timeMax, undefined, debug);

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

    console.log(`[PERF][chat] executeTool list_events: ${Date.now() - tExec}ms`);
    return { toolResult, stateUpdates: {} };
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
    const { eventId } = args as { eventId: string };
    try {
      await deleteEvent(eventId);
      debug.log({ type: 'tool_result', tool: 'delete_event', summary: `deleted ${eventId}` });
      console.log(`[PERF][chat] executeTool delete_event: ${Date.now() - tExec}ms`);
      return {
        toolResult: { success: true, deletedEventId: eventId },
        stateUpdates: {},
      };
    } catch {
      console.log(`[PERF][chat] executeTool delete_event (not found): ${Date.now() - tExec}ms`);
      return {
        toolResult: { success: false, error: 'Event not found or already deleted.' },
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
    const needsAutoSearch = hasAllRequiredSlots(state) && state.calendarResults.length === 0;
    if (needsAutoSearch) {
      const tAutoSearch = Date.now();
      debug.log({ type: 'tool_call', tool: 'find_free_slots', args: { duration: state.slots.duration, day: state.slots.day, timeWindow: state.slots.timeWindow } });
      const { toolResult, stateUpdates } = await executeTool(
        'find_free_slots',
        { duration: state.slots.duration!, day: state.slots.day!, timeWindow: state.slots.timeWindow! },
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

    console.log(`[PERF][chat] total request: ${Date.now() - t0}ms`);
    return NextResponse.json({
      message: displayText,
      voiceScript,
      sessionId,
      slots: formattedSlots,
      events: lastListedEvents || undefined,
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
