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
import { ConversationState } from '@/types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_TOOL_LOOPS = 5; // prevent infinite tool call chains
const MAX_HISTORY_TURNS = 12; // keep last 12 messages to limit token use

// ---------------------------------------------------------------------------
// Tool execution — returns the JSON result sent back to the LLM as a tool msg
// ---------------------------------------------------------------------------
async function executeTool(
  toolName: string,
  args: Record<string, any>,
  state: ConversationState,
  timezone: string,
  debug: DebugLogger
): Promise<{ toolResult: Record<string, any>; stateUpdates: Partial<ConversationState> }> {
  debug.log({ type: 'tool_call', tool: toolName, args });

  // ── find_free_slots ────────────────────────────────────────────────────────
  if (toolName === 'find_free_slots') {
    const { duration, day, timeWindow } = args as {
      duration: number;
      day: string;
      timeWindow: string;
    };

    const bounds = getTimeWindowBounds(day, timeWindow, timezone);

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

    if (slots.length === 0) {
      const conflict = await resolveConflict({ duration, day, timeWindow }, debug, timezone);
      slots = conflict.slots;
      conflictStrategy = conflict.strategy;
      conflictMessage = conflict.message;
    }

    // Update state to reflect what the LLM searched for (authoritative)
    const updatedSlots = {
      ...state.slots,
      duration,
      day,
      timeWindow,
    };

    debug.log({
      type: 'tool_result',
      tool: 'find_free_slots',
      summary: `${slots.length} slot(s) found, strategy=${conflictStrategy ?? 'direct'}`,
    });

    const toolResult = {
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
        attendees: (e.attendees ?? []).map((a: { email: string }) => a.email),
      })),
    };

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
      return {
        toolResult: { success: true, deletedEventId: eventId },
        stateUpdates: {},
      };
    } catch {
      return {
        toolResult: { success: false, error: 'Event not found or already deleted.' },
        stateUpdates: {},
      };
    }
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const debug = new DebugLogger();

  try {
    const { message, sessionId: providedSessionId, timezone = 'UTC' } = await req.json();

    const sessionId = providedSessionId || uuidv4();
    let state = (await getSession(sessionId)) ?? createInitialState(sessionId);

    // 1. Rule-based slot extraction (updates + stale detection)
    state = extractAndUpdateSlots(message, state, debug);

    // 2. Add user message to history
    state = addMessage(state, 'user', message);

    // 3. Auto-search: if all slots are filled and no fresh results exist, run find_free_slots
    //    immediately (saves an LLM round-trip — the LLM was going to call it anyway).
    const needsAutoSearch = hasAllRequiredSlots(state) && state.calendarResults.length === 0;
    if (needsAutoSearch) {
      debug.log({ type: 'tool_call', tool: 'find_free_slots', args: { duration: state.slots.duration, day: state.slots.day, timeWindow: state.slots.timeWindow } });
      const { toolResult, stateUpdates } = await executeTool(
        'find_free_slots',
        { duration: state.slots.duration!, day: state.slots.day!, timeWindow: state.slots.timeWindow! },
        state,
        timezone,
        debug
      );
      state = { ...state, ...stateUpdates } as ConversationState;
      if (stateUpdates.slots) state.slots = stateUpdates.slots as typeof state.slots;
    }

    // 4. Build messages for the LLM (trim history to last N turns to save tokens)
    const history = state.conversationHistory
      .slice(-(MAX_HISTORY_TURNS * 2))
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const chatMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(state, timezone) },
      ...history,
    ];

    // 5. Agentic tool loop
    let loopCount = 0;
    let finalText = '';

    while (loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      debug.log({
        type: 'llm_call',
        model: 'gpt-4o-mini',
        messageCount: chatMessages.length,
        toolsEnabled: true,
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: chatMessages,
        tools: TOOL_SCHEMAS,
        temperature: 0.1,
      });

      const assistantMsg = completion.choices[0].message;
      const toolCalls = assistantMsg.tool_calls ?? [];

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
          debug
        );

        // Apply state updates
        state = { ...state, ...stateUpdates } as ConversationState;
        if (stateUpdates.slots) state.slots = stateUpdates.slots as typeof state.slots;

        chatMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(toolResult),
        });
      }
      // Loop back to let the LLM formulate a response based on tool results
    }

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
    await saveSession(state);

    const formattedSlots = state.calendarResults.length > 0
      ? state.calendarResults.slice(0, 5).map(s => ({
          start: s.start,
          end: s.end,
          display: formatTimeSlot(s, timezone),
        }))
      : undefined;

    return NextResponse.json({
      message: displayText,
      voiceScript,
      sessionId,
      slots: formattedSlots,
      state: {
        slots: state.slots,
        hasAllSlots: hasAllRequiredSlots(state),
        awaitingConfirmation: state.awaitingConfirmation,
        slotsFound: state.calendarResults.length,
      },
      debug: debug.summary(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SCHEDULER:error]', message);
    return NextResponse.json({ error: 'Failed to process message', detail: message }, { status: 500 });
  }
}
