'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import ChatWindow from '@/components/ChatWindow';
import type { BookingProgressSnapshot, CancelProgressSnapshot } from '@/types';
import {
  bookingProgressContent,
  shouldApplyBookingProgress,
  upsertBookingProgressMessage,
  messagesHaveCompletedProgress,
  isNewBookingJob,
} from '@/lib/client/booking-progress-ui';
import {
  cancelProgressContent,
  shouldApplyCancelProgress,
  upsertCancelProgressMessage,
  isNewCancelJob,
} from '@/lib/client/cancel-progress-ui';
import { RealtimeResponseGate } from '@/lib/client/realtime-response-gate';
import {
  CONFLICT_HANDLING_RULES,
  PROXIMITY_SLOT_RULES,
  WORKING_HOURS_POLICY,
  MULTI_DAY_BOOKING_RULES,
  MULTI_BOOKING_GAP_RULES,
  ASYNC_PROMISE_BAN,
  BULK_CANCEL_RULES,
  RESCHEDULE_WORKFLOW_RULES,
} from '@/lib/agent/prompt-shared';
import {
  buildBookingJobPromptBlockFromSnapshot,
  bookingCompleteConversationHint,
} from '@/lib/agent/booking-context';
import {
  buildCancelJobPromptBlockFromSnapshot,
  cancelCompleteConversationHint,
} from '@/lib/agent/cancel-context';

type SlotOption = { display: string; start: string; end: string };
type EventItem = { id: string; summary: string; display: string };
type Message = {
  role: string;
  content: string;
  slots?: SlotOption[];
  events?: EventItem[];
  bookingProgress?: BookingProgressSnapshot;
  cancelProgress?: CancelProgressSnapshot;
};
type WorkingHours = { startHour: number; endHour: number };

function capEventsForDisplay(events: EventItem[]): EventItem[] {
  if (events.length <= 7) return events;
  return [
    ...events.slice(0, 5),
    {
      id: '_more',
      summary: `…and ${events.length - 5} more`,
      display: `${events.length} events total`,
    },
  ];
}

function loadWorkingHours(): WorkingHours {
  if (typeof window === 'undefined') return { startHour: 9, endHour: 17 };
  try {
    const stored = localStorage.getItem('workingHours');
    if (stored) return JSON.parse(stored);
  } catch {}
  return { startHour: 9, endHour: 17 };
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hi! I'm your scheduling assistant. I can help you find and book meeting times. What would you like to schedule?" },
  ]);
  const [input, setInput]             = useState('');
  const [isLoading, setIsLoading]     = useState(false);
  const [sessionId, setSessionId]     = useState<string | null>(null);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isVoiceConnecting, setIsVoiceConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [workingHours, setWorkingHours] = useState<WorkingHours>(loadWorkingHours);
  const [showSettings, setShowSettings] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const latestProgressRef = useRef<BookingProgressSnapshot | null>(null);
  const latestCancelProgressRef = useRef<CancelProgressSnapshot | null>(null);
  const responseGateRef = useRef(new RealtimeResponseGate());

  useEffect(() => {
    localStorage.setItem('workingHours', JSON.stringify(workingHours));
  }, [workingHours]);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(data => {
        if (data.authenticated) setUserEmail(data.email);
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  const pcRef          = useRef<RTCPeerConnection | null>(null);
  const dcRef          = useRef<RTCDataChannel | null>(null);
  const audioElRef     = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Streaming transcript accumulators
  const assistantTranscriptRef = useRef<string>('');
  const assistantMsgIndexRef   = useRef<number>(-1);
  // Debounce timer for flushing buffered transcript to UI
  const flushTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Index of the user placeholder pushed on speech_started; filled when transcript arrives
  const userMsgIndexRef        = useRef<number>(-1);
  // Tool result data stashed here, then merged into the model's next spoken transcript
  const pendingSlotsRef        = useRef<SlotOption[] | null>(null);
  const pendingEventsRef       = useRef<EventItem[] | null>(null);
  const pendingBookingRef      = useRef<BookingProgressSnapshot | null>(null);
  const bookingRunActiveRef    = useRef(false);
  const cancelRunActiveRef     = useRef(false);
  const voiceInstructionsBaseRef = useRef('');
  const lastBookingCompletePushedRef = useRef<string | null>(null);
  const lastCancelCompletePushedRef = useRef<string | null>(null);

  const timezone = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';

  const pushVoiceBookingCompleteContext = useCallback(
    async (snap: BookingProgressSnapshot, sid: string) => {
      if (snap.pending > 0 && snap.status !== 'completed') return;
      if (lastBookingCompletePushedRef.current === snap.jobId) return;
      lastBookingCompletePushedRef.current = snap.jobId;

      let confirmedSummary: string | null = null;
      try {
        const r = await fetch(
          `/api/booking/progress?sessionId=${encodeURIComponent(sid)}`
        );
        const data = await r.json();
        confirmedSummary = data.confirmedPlanSummary ?? null;
      } catch {
        /* ignore */
      }

      const dc = dcRef.current;
      if (!dc || dc.readyState !== 'open') return;

      const block = buildBookingJobPromptBlockFromSnapshot(snap, confirmedSummary);
      const base = voiceInstructionsBaseRef.current;
      if (base && block) {
        dc.send(
          JSON.stringify({
            type: 'session.update',
            session: { type: 'realtime', instructions: base + block },
          })
        );
      }

      dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: bookingCompleteConversationHint(snap) },
            ],
          },
        })
      );
    },
    []
  );

  const runBookingJob = useCallback(async (sid: string) => {
    if (bookingRunActiveRef.current) return;
    bookingRunActiveRef.current = true;
    let lastSnap: BookingProgressSnapshot | null = null;
    try {
      const res = await fetch('/api/booking/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      });
      if (!res.ok || !res.body) throw new Error('Booking run failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'progress' || payload.type === 'complete') {
              if (payload.duplicateBlocked) continue;
              const snap: BookingProgressSnapshot = {
                jobId: payload.jobId ?? sid,
                status: payload.status ?? (payload.type === 'complete' ? 'completed' : 'in_progress'),
                total: payload.total ?? 0,
                booked: payload.booked ?? 0,
                failed: payload.failed ?? 0,
                pending: payload.pending ?? 0,
                skipped: payload.skipped ?? 0,
                percent: payload.percent ?? 0,
                items: payload.items ?? [],
              };
              if (!shouldApplyBookingProgress(latestProgressRef.current, snap)) continue;
              latestProgressRef.current = snap;
              lastSnap = snap;
              setMessages(prev =>
                upsertBookingProgressMessage(prev, snap) as Message[]
              );
            }
          } catch {
            /* ignore malformed SSE chunks */
          }
        }
      }

      if (
        lastSnap &&
        (lastSnap.pending === 0 || lastSnap.status === 'completed') &&
        dcRef.current?.readyState === 'open'
      ) {
        void pushVoiceBookingCompleteContext(lastSnap, sid);
      }
    } catch (err) {
      console.error('[BookingRun]', err);
    } finally {
      bookingRunActiveRef.current = false;
    }
  }, [pushVoiceBookingCompleteContext]);

  const pushVoiceCancelCompleteContext = useCallback(
    async (snap: CancelProgressSnapshot, sid: string) => {
      if (snap.pending > 0 && snap.status !== 'completed') return;
      if (lastCancelCompletePushedRef.current === snap.jobId) return;
      lastCancelCompletePushedRef.current = snap.jobId;

      let confirmedSummary: string | null = null;
      try {
        const r = await fetch(
          `/api/cancel/progress?sessionId=${encodeURIComponent(sid)}`
        );
        const data = await r.json();
        confirmedSummary = data.confirmedCancelSummary ?? null;
      } catch {
        /* ignore */
      }

      const dc = dcRef.current;
      if (!dc || dc.readyState !== 'open') return;

      const block = buildCancelJobPromptBlockFromSnapshot(snap, confirmedSummary);
      const base = voiceInstructionsBaseRef.current;
      if (base && block) {
        dc.send(
          JSON.stringify({
            type: 'session.update',
            session: { type: 'realtime', instructions: base + block },
          })
        );
      }

      dc.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: cancelCompleteConversationHint(snap) },
            ],
          },
        })
      );
    },
    []
  );

  const runCancelJob = useCallback(async (sid: string) => {
    if (cancelRunActiveRef.current) return;
    cancelRunActiveRef.current = true;
    let lastSnap: CancelProgressSnapshot | null = null;
    try {
      const res = await fetch('/api/cancel/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      });
      if (!res.ok || !res.body) throw new Error('Cancel run failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === 'progress' || payload.type === 'complete') {
              if (payload.duplicateBlocked) continue;
              const snap: CancelProgressSnapshot = {
                jobId: payload.jobId ?? sid,
                status:
                  payload.status ??
                  (payload.type === 'complete' ? 'completed' : 'in_progress'),
                total: payload.total ?? 0,
                cancelled: payload.cancelled ?? 0,
                failed: payload.failed ?? 0,
                pending: payload.pending ?? 0,
                skipped: payload.skipped ?? 0,
                percent: payload.percent ?? 0,
                items: payload.items ?? [],
              };
              if (!shouldApplyCancelProgress(latestCancelProgressRef.current, snap)) {
                continue;
              }
              latestCancelProgressRef.current = snap;
              lastSnap = snap;
              setMessages(prev =>
                upsertCancelProgressMessage(prev, snap) as Message[]
              );
            }
          } catch {
            /* ignore */
          }
        }
      }

      if (
        lastSnap &&
        (lastSnap.pending === 0 || lastSnap.status === 'completed') &&
        dcRef.current?.readyState === 'open'
      ) {
        void pushVoiceCancelCompleteContext(lastSnap, sid);
      }
    } catch (err) {
      console.error('[CancelRun]', err);
    } finally {
      cancelRunActiveRef.current = false;
    }
  }, [pushVoiceCancelCompleteContext]);

  // ── Text chat (existing pipeline) ─────────────────────────────────────────
  const sendTextMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    const tChat = Date.now();
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, timezone, workingHours }),
      });
      const data = await res.json();
      console.log(`[PERF][client] text chat round-trip: ${Date.now() - tChat}ms`);
      if (data.error) throw new Error(data.error);

      const assistantMsg: Message = { role: 'assistant', content: data.message };
      if (data.slots?.length) assistantMsg.slots = data.slots;
      if (data.events?.length) assistantMsg.events = data.events;
      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

      const sid = data.sessionId || sessionId;
      setMessages(prev => {
        let next = [...prev, assistantMsg];
        if (data.bookingJob) {
          if (isNewBookingJob(latestProgressRef.current, data.bookingJob)) {
            latestProgressRef.current = data.bookingJob;
          } else if (shouldApplyBookingProgress(latestProgressRef.current, data.bookingJob)) {
            latestProgressRef.current = data.bookingJob;
          }
          if (latestProgressRef.current === data.bookingJob) {
            next = upsertBookingProgressMessage(next, data.bookingJob, {
              attachToLastAssistant: true,
            }) as Message[];
          }
        }
        if (data.cancelJob) {
          if (isNewCancelJob(latestCancelProgressRef.current, data.cancelJob)) {
            latestCancelProgressRef.current = data.cancelJob;
          } else if (shouldApplyCancelProgress(latestCancelProgressRef.current, data.cancelJob)) {
            latestCancelProgressRef.current = data.cancelJob;
          }
          if (latestCancelProgressRef.current === data.cancelJob) {
            next = upsertCancelProgressMessage(next, data.cancelJob, {
              attachToLastAssistant: true,
            }) as Message[];
          }
        }
        return next;
      });
      if (data.startBookingRun && sid) {
        await runBookingJob(sid);
      }
      if (data.startCancelRun && sid) {
        await runCancelJob(sid);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sessionId, timezone, workingHours, runBookingJob, runCancelJob]);

  // ── Handle tool calls from Realtime API ────────────────────────────────────
  const handleRealtimeToolCall = useCallback(async (callId: string, toolName: string, args: string) => {
    const tTool = Date.now();
    console.log('[Realtime][Tool] Executing:', toolName, args);
    try {
      const parsedArgs = JSON.parse(args);
      const res = await fetch('/api/realtime/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args: parsedArgs, sessionId, timezone, workingHours }),
      });
      const data = await res.json();
      console.log(`[PERF][client] voice tool round-trip (${toolName}): ${Date.now() - tTool}ms`);
      console.log('[Realtime][Tool] Result:', JSON.stringify(data.result).slice(0, 200));
      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

      // Stash tool result data — merged into the model's next spoken transcript
      // so only ONE representation appears in chat (cards), not two.
      if ((toolName === 'find_free_slots' || toolName === 'find_next_slot') && data.result?.slots?.length) {
        pendingSlotsRef.current = data.result.slots;
      } else if (toolName === 'list_events' && data.result?.events?.length) {
        pendingEventsRef.current = capEventsForDisplay(data.result.events);
      } else if (
        (toolName === 'init_booking_job' || toolName === 'execute_booking_batch') &&
        data.result?.progress
      ) {
        const next = data.result.progress as BookingProgressSnapshot;
        const blocked = data.result.error === 'job_already_done';
        if (isNewBookingJob(latestProgressRef.current, next)) {
          latestProgressRef.current = next;
        } else if (shouldApplyBookingProgress(latestProgressRef.current, next)) {
          latestProgressRef.current = next;
        }
        if (!blocked && latestProgressRef.current === next) {
          pendingBookingRef.current = next;
        }
        if (data.result.startBookingRun && data.sessionId && !data.result.error) {
          void runBookingJob(data.sessionId);
        }
        const sidDone = data.sessionId || sessionId;
        if (
          sidDone &&
          data.result?.progress &&
          (data.result.error === 'job_already_done' ||
            data.result.done === true ||
            (data.result.progress.pending === 0 && data.result.progress.booked > 0))
        ) {
          void pushVoiceBookingCompleteContext(
            data.result.progress as BookingProgressSnapshot,
            sidDone
          );
        }
      } else if (
        (toolName === 'init_cancel_job' || toolName === 'execute_cancel_batch') &&
        data.result?.progress
      ) {
        const next = data.result.progress as CancelProgressSnapshot;
        const blocked = data.result.error === 'job_already_done';
        if (isNewCancelJob(latestCancelProgressRef.current, next)) {
          latestCancelProgressRef.current = next;
        } else if (shouldApplyCancelProgress(latestCancelProgressRef.current, next)) {
          latestCancelProgressRef.current = next;
        }
        if (!blocked && latestCancelProgressRef.current === next) {
          setMessages(prev =>
            upsertCancelProgressMessage(prev, next) as Message[]
          );
        }
        if (data.result.startCancelRun && data.sessionId && !data.result.error) {
          void runCancelJob(data.sessionId);
        }
        const sidCancel = data.sessionId || sessionId;
        if (
          sidCancel &&
          data.result?.progress &&
          (data.result.error === 'job_already_done' ||
            data.result.done === true ||
            (data.result.progress.pending === 0 &&
              data.result.progress.cancelled > 0))
        ) {
          void pushVoiceCancelCompleteContext(
            data.result.progress as CancelProgressSnapshot,
            sidCancel
          );
        }
      } else if (toolName === 'create_event' && data.result?.success === false) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${data.result.error}`,
        }]);
      }

      responseGateRef.current.submitToolResult(callId, data.result);
    } catch (err) {
      console.error('[Realtime][Tool] Error:', err);
      pendingSlotsRef.current = null;
      pendingEventsRef.current = null;
      responseGateRef.current.submitToolResult(callId, {
        error: 'Tool execution failed',
      });
    }
  }, [
    sessionId,
    timezone,
    workingHours,
    runBookingJob,
    runCancelJob,
    pushVoiceBookingCompleteContext,
    pushVoiceCancelCompleteContext,
  ]);

  // ── Build session config for GA Realtime API ───────────────────────────────
  const buildSessionConfig = useCallback(() => {
    const now      = new Date();
    const today    = now.toLocaleDateString('en-CA', { timeZone: timezone });
    const dayName  = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
    const timeStr  = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toLocaleDateString('en-CA', { timeZone: timezone });
    const tomorrowDay  = tomorrow.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });

    const dayAfter = new Date(now);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dayAfterDate = dayAfter.toLocaleDateString('en-CA', { timeZone: timezone });
    const dayAfterDay  = dayAfter.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });

    const instructions = `You are a warm, sharp voice scheduling assistant. You speak naturally, handle all calendar requests fluently, and never miss information the user already gave you.

━━━ DATE REFERENCE (use these EXACT values — do NOT calculate dates yourself) ━━━
Today: ${dayName}, ${today}
Tomorrow: ${tomorrowDay}, ${tomorrowDate}
Day after tomorrow: ${dayAfterDay}, ${dayAfterDate}
Current time: ${timeStr}
User timezone: ${timezone}

━━━ USER WORKING HOURS ━━━
Default range for vague time searches: ${workingHours.startHour}:00 – ${workingHours.endHour}:00 (${timezone}).
${WORKING_HOURS_POLICY}

CRITICAL: When the user says "tomorrow", ALWAYS use ${tomorrowDate}. When they say "day after tomorrow", use ${dayAfterDate}. Do NOT add extra days. The backend enforces all time constraints.

━━━ DURATION PARSING (EXACT — never substitute a different value) ━━━
Convert the user's stated duration to minutes PRECISELY:
  "15 min" / "quarter hour" → 15
  "30 min" / "half an hour" / "quick call" / "brief" → 30
  "45 min" → 45
  "1 hour" / "an hour" / "one hour" / "60 min" → 60
  "90 min" / "hour and a half" / "1.5 hours" → 90
  "2 hours" / "two hours" → 120
  "3 hours" / "three hours" → 180
  "4 hours" → 240
  "5 hours" → 300
  "6 hours" / "six hours" → 360
  "7 hours" → 420
  "8 hours" → 480
  "N hours" → N × 60 (always multiply by 60)
NEVER change or "round" the user's duration. If they say 6 hours, the duration is 360 minutes, not 120.

━━━ INTENT RECOGNITION ━━━

BOOK A MEETING — "schedule", "book", "set up", "find time", "arrange", "block time", etc.
  You need: duration + intent (ASAP OR a specific day/window).

  ASAP — "ASAP", "as soon as possible", "soonest", "right now", "urgent", "today if possible", "next available":
    → Call find_next_slot(duration). Only ask for duration if truly missing. NEVER ask for a day or time window.

  SPECIFIC TIME — "tomorrow", "Monday", "at 10 AM", "9 to 11":
    → Resolve the day to YYYY-MM-DD. If user names a clock time, pass preferredStartTime (and preferredEndTime for ranges).
    → Call find_free_slots(duration, day, timeWindow, preferredStartTime, preferredEndTime).

  If duration is missing: ask exactly — "How long should the meeting be?"

CHECK CALENDAR — "what's on my calendar", "what do I have", "my schedule", "show my meetings", "am I free", "what's booked", "show again", etc.
  → You MUST call list_events every time. NEVER recite events from memory or from a previous call.
  → Even if you just listed events 10 seconds ago, call list_events again.
  → Use appropriate range:
      "today" → ${today}T00:00:00Z to ${today}T23:59:59Z
      "tomorrow" → ${tomorrowDate}T00:00:00Z to ${tomorrowDate}T23:59:59Z
      "this week" → next 7 days.
      "yesterday" → the day before today.
  → Report clearly: event name + time. If nothing is booked, say so warmly.

CANCEL / DELETE — "cancel", "remove", "delete", "drop", "clear", etc.
  → Use lookup_event or list_events to find the event.
  → If EXACTLY ONE match: call delete_event IMMEDIATELY. Do NOT ask "are you sure?" — the user already said to cancel.
  → If MULTIPLE and user wants ALL / cancel all listed: use init_cancel_job after ONE confirmation (count + range) — do NOT call delete_event one-by-one.
  → If MULTIPLE and user picks ONE: delete_event for that ID only.

${BULK_CANCEL_RULES}

When you see [CANCEL_COMPLETE] in the conversation, cancellations are done — do not call delete_event again.

${RESCHEDULE_WORKFLOW_RULES}

${MULTI_DAY_BOOKING_RULES}

When you see a [BOOKING_COMPLETE] message in the conversation, all listed meetings are already on the calendar — confirm success to the user; never call create_event or find_free_slots to re-book.

${MULTI_BOOKING_GAP_RULES}

${ASYNC_PROMISE_BAN}

━━━ MERGE MEETINGS ━━━
When user says "merge", "combine", "consolidate" meetings in a time range:
  - "Merge" means: delete the individual overlapping/adjacent meetings and create ONE event that spans from the EARLIEST start to the LATEST end of those meetings.
  - Do NOT sum durations. The merged event simply covers the full range.
  - If the user specified an explicit time range (e.g. "merge from 7am to 12pm"), use THOSE times as the merged event's start and end.
  - Steps: 1) list_events to find them, 2) confirm with user, 3) delete each old event, 4) create_event with the merged range.
  - Example: Meetings at 8–10, 9–11, 10–12 → merged = 8:00 AM – 12:00 PM (not 8AM to 3PM).

━━━ SCHEDULING ARITHMETIC ━━━
When users express scheduling constraints, think through the math:
  - "Closing time is 5 PM" + "6 hour meeting" → meeting must start by 11 AM.
  - "Between 9 and 12" + "2 hour meeting" → slot must start by 10 AM.
  - Always respect user-stated work hours / closing times when filtering results.

${CONFLICT_HANDLING_RULES}

${PROXIMITY_SLOT_RULES}

━━━ CONVERSATION RULES ━━━

1. ALWAYS review the full conversation before responding. Carry forward earlier details.
2. Never ask for something the user already stated. Never ask two things at once.
3. Once you have what you need, call the right tool immediately.
4. After a search: present up to 3 slots as a numbered list. Say the day clearly, then the time.
5. After listing slots: ask "Which one works for you?" — wait for confirmation before booking.
6. On confirmation: for multi-day/batch (see MULTI_DAY_BOOKING_RULES above), use init_booking_job + execute_booking_batch — not create_event per day. For single-day only, call create_event with EXACT ISO start/end from the tool result.
7. Meeting title: if user didn't provide one, default to "Meeting".
8. After booking: confirm the event name, day, and time in one sentence.
9. If the user changes their mind mid-flow, adapt.

━━━ VOICE STYLE ━━━

Speak naturally — short sentences, warm tone.
For slot lists, name just the day and time (e.g. "Monday at 2 PM") — skip UTC strings.
Never say "I'm unable to" or "I'm sorry, I can't". Redirect to what you CAN do.
English only.`;

    voiceInstructionsBaseRef.current = instructions;

    return {
      type: 'realtime',
      instructions,
      tools: [
        {
          type: 'function',
          name: 'find_next_slot',
          description: 'Find the SOONEST available slot from right now. Use for "ASAP", "as soon as possible", "next available", "soonest". Backend automatically searches today and upcoming days. Only needs duration.',
          parameters: {
            type: 'object',
            properties: {
              duration: { type: 'number', description: 'Meeting duration in minutes (e.g. 30, 60)' },
            },
            required: ['duration'],
          },
        },
        {
          type: 'function',
          name: 'find_free_slots',
          description: 'Find slots on a day/window. Pass preferredStartTime when user names a specific time — returns requestedSlot blockers + proximity-ranked alternatives.',
          parameters: {
            type: 'object',
            properties: {
              duration:   { type: 'number', description: 'Duration in minutes' },
              day:        { type: 'string', description: 'ISO date YYYY-MM-DD' },
              timeWindow: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'anytime'] },
              preferredStartTime: { type: 'string', description: 'e.g. "10:00" or "10 AM"' },
              preferredEndTime: { type: 'string', description: 'End of range if user said "9 to 11"' },
            },
            required: ['duration', 'day', 'timeWindow'],
          },
        },
        {
          type: 'function',
          name: 'init_booking_job',
          description: 'Initialize multi-day booking job after user confirms. Then execute_booking_batch once.',
          parameters: {
            type: 'object',
            properties: {
              entries: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    day: { type: 'string' },
                    start: { type: 'string' },
                    end: { type: 'string' },
                    summary: { type: 'string' },
                  },
                  required: ['day', 'start', 'end', 'summary'],
                },
              },
            },
            required: ['entries'],
          },
        },
        {
          type: 'function',
          name: 'execute_booking_batch',
          description: 'Book next batch from active job. Client auto-continues via SSE.',
          parameters: {
            type: 'object',
            properties: {
              batchSize: { type: 'number' },
            },
          },
        },
        {
          type: 'function',
          name: 'init_cancel_job',
          description: 'Bulk cancel after user confirms. Pass eventIds from list_events; server expands from cache. Do NOT delete_event one-by-one.',
          parameters: {
            type: 'object',
            properties: {
              eventIds: { type: 'array', items: { type: 'string' } },
              force: { type: 'boolean' },
            },
            required: ['eventIds'],
          },
        },
        {
          type: 'function',
          name: 'execute_cancel_batch',
          description: 'Cancel next batch from active cancel job. Client auto-continues via SSE.',
          parameters: {
            type: 'object',
            properties: { batchSize: { type: 'number' } },
          },
        },
        {
          type: 'function',
          name: 'plan_multi_day_bookings',
          description: 'Plan same-time bookings across multiple days. Returns autoBookable vs conflict days (one alternative per conflict). Use dayPattern for "every weekday next month" / "first week of June" instead of enumerating all dates manually.',
          parameters: {
            type: 'object',
            properties: {
              durationMinutes: { type: 'number' },
              days: { type: 'array', items: { type: 'string' }, description: 'ISO dates YYYY-MM-DD (may be empty when dayPattern is used)' },
              preferredTime: { type: 'string', description: 'Local time each day e.g. "10 AM" or "5:00"' },
              dayPattern: {
                type: 'object',
                description: 'Server-side day resolver — preferred over enumerating dates manually for monthly/weekly patterns',
                properties: {
                  monthOffset: { type: 'number', description: '0=this month, 1=next month' },
                  weekdaysOnly: { type: 'boolean', description: 'true = Mon–Fri only within the resolved month' },
                  week: { type: 'string', enum: ['first', 'last'], description: 'first or last week of month only' },
                  month: { type: 'number', description: 'Target month 1–12 (e.g. 6 for June)' },
                  year: { type: 'number', description: 'Target year; omit to use current year' },
                },
              },
              userMessage: { type: 'string', description: 'Original user phrasing for server day resolution, e.g. "every weekday next month"' },
              summary: { type: 'string', description: 'Event title for all days, e.g. "Standup" or "Yoga"' },
            },
            required: ['durationMinutes', 'days', 'preferredTime'],
          },
        },
        {
          type: 'function',
          name: 'create_event',
          description: 'Book a meeting. Use ONLY start/end times from find_next_slot or find_free_slots results. Backend validates times.',
          parameters: {
            type: 'object',
            properties: {
              summary:   { type: 'string', description: 'Meeting title' },
              startTime: { type: 'string', description: 'Start time from slot result (ISO UTC)' },
              endTime:   { type: 'string', description: 'End time from slot result (ISO UTC)' },
            },
            required: ['summary', 'startTime', 'endTime'],
          },
        },
        {
          type: 'function',
          name: 'list_events',
          description: 'List existing calendar events. Use for "what\'s booked", "my schedule", "what meetings do I have". Returns event IDs needed for delete_event.',
          parameters: {
            type: 'object',
            properties: {
              timeMin: { type: 'string', description: 'Start of range (UTC ISO)' },
              timeMax: { type: 'string', description: 'End of range (UTC ISO)' },
            },
            required: ['timeMin', 'timeMax'],
          },
        },
        {
          type: 'function',
          name: 'identify_event',
          description: 'Find events in a time range by time hint ("4 to 7") and/or title. Required for reschedule.',
          parameters: {
            type: 'object',
            properties: {
              timeMin: { type: 'string' },
              timeMax: { type: 'string' },
              timeHint: { type: 'string' },
              summaryHint: { type: 'string' },
              day: { type: 'string' },
            },
            required: ['timeMin', 'timeMax'],
          },
        },
        {
          type: 'function',
          name: 'reschedule_event',
          description: 'Preview (confirmed=false) or execute (confirmed=true) reschedule after identify_event.',
          parameters: {
            type: 'object',
            properties: {
              eventId: { type: 'string' },
              newStartTime: { type: 'string' },
              newEndTime: { type: 'string' },
              confirmed: { type: 'boolean' },
            },
            required: ['eventId', 'newStartTime', 'newEndTime', 'confirmed'],
          },
        },
        {
          type: 'function',
          name: 'lookup_event',
          description: 'Search by name only — for cancel by title, NOT for time ranges like "4 to 7".',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Event name or keywords' },
            },
            required: ['query'],
          },
        },
        {
          type: 'function',
          name: 'delete_event',
          description: 'Delete a calendar event by ID. For cancel: delete immediately after identify_event when one match. For reschedule: use reschedule_event(confirmed=true) instead of manual delete+create.',
          parameters: {
            type: 'object',
            properties: {
              eventId: { type: 'string', description: 'The event ID from list_events or lookup_event' },
            },
            required: ['eventId'],
          },
        },
      ],
      tool_choice: 'auto',
    };
  }, [timezone, workingHours]);

  // ── Handle incoming DataChannel messages ───────────────────────────────────
  const handleDataChannelMessage = useCallback((event: any) => {
    // Debug: log ALL events to browser console
    console.log('[Realtime][DC]', event.type, JSON.stringify(event).slice(0, 300));

    switch (event.type) {
      // Session confirmed
      case 'session.created':
      case 'session.updated': {
        console.log('[Realtime] Session configured:', event.session?.id || 'ok');
        break;
      }

      // User started speaking — reserve a placeholder so the user message
      // appears before the assistant response in the chat even when the
      // transcription event arrives late (after the model starts responding)
      case 'input_audio_buffer.speech_started': {
        if (userMsgIndexRef.current === -1) {
          setMessages(prev => {
            userMsgIndexRef.current = prev.length;
            return [...prev, { role: 'user', content: '…' }];
          });
        }
        break;
      }

      // User's speech transcription completed — fill in the placeholder
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = event.transcript?.trim();
        console.log('[Realtime][User transcript]', transcript);
        if (transcript) {
          const idx = userMsgIndexRef.current;
          if (idx >= 0) {
            setMessages(prev => {
              const updated = [...prev];
              if (idx < updated.length) updated[idx] = { role: 'user', content: transcript };
              return updated;
            });
            userMsgIndexRef.current = -1;
          } else {
            setMessages(prev => [...prev, { role: 'user', content: transcript }]);
          }
        } else {
          // No transcript (silence / too brief) — remove the placeholder
          const idx = userMsgIndexRef.current;
          if (idx >= 0) {
            setMessages(prev => prev.filter((_, i) => i !== idx));
            userMsgIndexRef.current = -1;
          }
        }
        break;
      }

      // Assistant audio transcript streaming (GA API event name)
      // Uses sentence-level buffering: accumulate text in a ref, flush to UI
      // only on sentence boundaries or via a 200ms debounce timer.
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta': {
        const delta = event.delta || '';
        assistantTranscriptRef.current += delta;

        if (assistantMsgIndexRef.current === -1) {
          // Mark as "creation pending" synchronously to prevent rapid deltas
          // from each creating a separate message bubble (race condition)
          assistantMsgIndexRef.current = -2;
          setMessages(prev => {
            assistantMsgIndexRef.current = prev.length;
            return [...prev, { role: 'assistant', content: assistantTranscriptRef.current }];
          });
        } else if (assistantMsgIndexRef.current >= 0) {
          const text = assistantTranscriptRef.current;
          const hasBoundary = /[.?!:]\s*$/.test(text) || /\n/.test(delta);

          if (hasBoundary) {
            // Sentence boundary — flush immediately
            if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
            const idx = assistantMsgIndexRef.current;
            setMessages(prev => {
              const updated = [...prev];
              if (idx < updated.length) updated[idx] = { role: 'assistant', content: text };
              return updated;
            });
          } else {
            // No boundary yet — debounce so partial text still appears after 200ms
            if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
            flushTimerRef.current = setTimeout(() => {
              const t = assistantTranscriptRef.current;
              const i = assistantMsgIndexRef.current;
              if (i >= 0) {
                setMessages(prev => {
                  const updated = [...prev];
                  if (i < updated.length) updated[i] = { role: 'assistant', content: t };
                  return updated;
                });
              }
              flushTimerRef.current = null;
            }, 200);
          }
        }
        // When === -2 (creation pending), deltas accumulate in the ref;
        // the first setMessages callback sets the real index, and the
        // next delta will flush all accumulated text.
        setIsSpeaking(true);
        break;
      }

      // Assistant audio transcript finalized (GA API event name)
      // If pending slots exist, merge them into this message so only ONE
      // representation appears (model's intro text + interactive slot cards).
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done': {
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        const text = event.transcript?.trim();
        console.log('[Realtime][Assistant transcript done]', text?.slice(0, 100));

        const slots = pendingSlotsRef.current;
        const events = pendingEventsRef.current;
        const booking = pendingBookingRef.current;
        pendingSlotsRef.current = null;
        pendingEventsRef.current = null;
        pendingBookingRef.current = null;

        const fallback = slots?.length ? 'Here are the available slots — pick one to book:'
          : events?.length ? 'Here\'s your schedule:'
          : booking ? 'Booking your meetings — see progress below.' : '';

        const msg: Message = {
          role: 'assistant',
          content: text || fallback,
          ...(slots?.length ? { slots } : {}),
          ...(events?.length ? { events } : {}),
        };

        if (text && assistantMsgIndexRef.current >= 0) {
          const idx = assistantMsgIndexRef.current;
          setMessages(prev => {
            let updated = [...prev];
            if (idx < updated.length) updated[idx] = msg;
            if (booking && !messagesHaveCompletedProgress(prev, booking.jobId)) {
              if (isNewBookingJob(latestProgressRef.current, booking)) {
                latestProgressRef.current = booking;
              } else if (shouldApplyBookingProgress(latestProgressRef.current, booking)) {
                latestProgressRef.current = booking;
              }
              if (latestProgressRef.current === booking) {
                updated = upsertBookingProgressMessage(updated, booking, {
                  content: text || bookingProgressContent(booking),
                  attachToLastAssistant: true,
                }) as Message[];
              }
            }
            return updated;
          });
        } else if (msg.content) {
          setMessages(prev => {
            if (booking && !messagesHaveCompletedProgress(prev, booking.jobId)) {
              if (isNewBookingJob(latestProgressRef.current, booking)) {
                latestProgressRef.current = booking;
              } else if (shouldApplyBookingProgress(latestProgressRef.current, booking)) {
                latestProgressRef.current = booking;
              }
              if (latestProgressRef.current === booking) {
                const withMsg = [...prev, msg];
                return upsertBookingProgressMessage(withMsg, booking, {
                  attachToLastAssistant: true,
                }) as Message[];
              }
            }
            return [...prev, msg];
          });
        }

        assistantTranscriptRef.current = '';
        assistantMsgIndexRef.current = -1;
        break;
      }

      // Text-only response
      case 'response.text.done': {
        const text = event.text?.trim();
        console.log('[Realtime][Text response]', text?.slice(0, 100));
        if (text) {
          setMessages(prev => [...prev, { role: 'assistant', content: text }]);
        }
        break;
      }

      case 'response.created': {
        const rid = event.response?.id ?? event.id;
        if (rid) responseGateRef.current.onResponseCreated(rid);
        break;
      }

      case 'response.done':
      case 'response.failed':
      case 'response.cancelled': {
        if (event.type === 'response.done') {
          console.log('[Realtime] Response done');
          setIsSpeaking(false);
          assistantTranscriptRef.current = '';
          assistantMsgIndexRef.current = -1;
        }
        responseGateRef.current.onResponseEnded();
        break;
      }

      // Function call complete — execute tool
      case 'response.function_call_arguments.done': {
        console.log('[Realtime][FnCall]', event.name, event.arguments?.slice(0, 100));
        responseGateRef.current.registerFunctionCall(event.call_id);
        handleRealtimeToolCall(event.call_id, event.name, event.arguments);
        break;
      }

      // Error
      case 'error': {
        console.error('[Realtime][Error]', JSON.stringify(event.error));
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Voice error: ${event.error?.message || JSON.stringify(event.error)}`,
        }]);
        break;
      }

      // Catch-all for unhandled events (debug)
      default: {
        if (event.type && !event.type.startsWith('response.audio.') && !event.type.startsWith('input_audio_buffer')) {
          console.log('[Realtime][Unhandled]', event.type);
        }
      }
    }
  }, [handleRealtimeToolCall]);

  // ── Connect to OpenAI Realtime API via WebRTC ──────────────────────────────
  const connectVoice = useCallback(async () => {
    if (isVoiceActive || isVoiceConnecting) return;
    setIsVoiceConnecting(true);

    try {
      const tConnect = Date.now();
      const tToken = Date.now();
      const tokenRes = await fetch('/api/realtime/session', { method: 'POST' });
      const { token } = await tokenRes.json();
      if (!token) throw new Error('Failed to get realtime token');
      console.log(`[PERF][client] token fetch: ${Date.now() - tToken}ms`);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        console.log('[Realtime] Got remote audio track');
        audioEl.srcObject = e.streams[0];
      };

      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      console.log('[Realtime] Mic track added');

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        console.log('[Realtime] DataChannel open — sending session.update');
        responseGateRef.current.setSendFn(payload => {
          if (dc.readyState === 'open') dc.send(payload);
        });
        responseGateRef.current.reset();
        const config = buildSessionConfig();
        console.log('[Realtime] Session config:', JSON.stringify(config).slice(0, 300));
        dc.send(JSON.stringify({
          type: 'session.update',
          session: config,
        }));
      };

      dc.onmessage = (e) => {
        try {
          handleDataChannelMessage(JSON.parse(e.data));
        } catch (err) {
          console.warn('[Realtime] DC parse error:', err, e.data?.slice(0, 100));
        }
      };

      dc.onerror = (e) => console.error('[Realtime] DC error:', e);
      dc.onclose = () => console.log('[Realtime] DC closed');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('[Realtime] SDP offer created');

      const tSdp = Date.now();
      const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpRes.ok) {
        const errBody = await sdpRes.text();
        throw new Error(`SDP exchange failed: ${sdpRes.status} — ${errBody}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      console.log(`[PERF][client] SDP exchange: ${Date.now() - tSdp}ms`);
      console.log(`[PERF][client] voice connection total: ${Date.now() - tConnect}ms`);
      console.log('[Realtime] WebRTC connected successfully');

      setIsVoiceActive(true);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '🎙️ Voice mode active — speak in English. Click the mic button to disconnect.',
      }]);
    } catch (err) {
      console.error('[Realtime] Connection error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Voice connection failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }]);
      disconnectVoice();
    } finally {
      setIsVoiceConnecting(false);
    }
  }, [isVoiceActive, isVoiceConnecting, buildSessionConfig, handleDataChannelMessage]);

  // ── Disconnect voice ───────────────────────────────────────────────────────
  const disconnectVoice = useCallback(() => {
    if (dcRef.current) { dcRef.current.close(); dcRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    setIsVoiceActive(false);
    setIsSpeaking(false);
    assistantTranscriptRef.current = '';
    assistantMsgIndexRef.current = -1;
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    userMsgIndexRef.current = -1;
    pendingSlotsRef.current = null;
    pendingEventsRef.current = null;
    pendingBookingRef.current = null;
    latestProgressRef.current = null;
    latestCancelProgressRef.current = null;
    lastBookingCompletePushedRef.current = null;
    lastCancelCompletePushedRef.current = null;
    responseGateRef.current.reset();
    responseGateRef.current.setSendFn(null);
  }, []);

  const toggleVoice = useCallback(() => {
    if (isVoiceActive) {
      disconnectVoice();
      setMessages(prev => [...prev, { role: 'assistant', content: 'Voice mode disconnected.' }]);
    } else {
      connectVoice();
    }
  }, [isVoiceActive, disconnectVoice, connectVoice]);

  useEffect(() => () => { disconnectVoice(); }, [disconnectVoice]);

  // ── Slot pick (from clickable slot cards) ──────────────────────────────────
  const handleSlotPick = useCallback((slot: SlotOption) => {
    const confirmText = `Let's go with the slot at ${slot.display}`;

    if (isVoiceActive && dcRef.current?.readyState === 'open') {
      setMessages(prev => [...prev, { role: 'user', content: confirmText }]);
      dcRef.current.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: confirmText }],
        },
      }));
      responseGateRef.current.requestResponse();
    } else {
      sendTextMessage(confirmText);
    }
  }, [isVoiceActive, sendTextMessage]);

  const handleSend    = useCallback(() => sendTextMessage(input), [input, sendTextMessage]);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="container">
      <div className="chat-window">
        <div className="chat-header">
          <span>Smart Scheduler AI</span>
          <div className="header-controls">
            {userEmail && <span className="user-email">{userEmail}</span>}
            {isVoiceActive && <span className="speaking-indicator">{isSpeaking ? '🔊' : '🎙️'}</span>}
            <button
              className="settings-toggle"
              onClick={() => setShowSettings(s => !s)}
              title="Working hours settings"
            >
              ⚙
            </button>
            {userEmail && (
              <button
                className="settings-toggle"
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  window.location.href = '/api/auth/login';
                }}
                title="Sign out"
              >
                ↪
              </button>
            )}
          </div>
        </div>

        {showSettings && (
          <div className="settings-panel">
            <label className="settings-label">Working Hours</label>
            <div className="settings-row">
              <select
                className="settings-select"
                value={workingHours.startHour}
                onChange={e => setWorkingHours(wh => ({ ...wh, startHour: Number(e.target.value) }))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              <span className="settings-separator">to</span>
              <select
                className="settings-select"
                value={workingHours.endHour}
                onChange={e => setWorkingHours(wh => ({ ...wh, endHour: Number(e.target.value) }))}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <ChatWindow messages={messages} isLoading={isLoading} onSlotPick={handleSlotPick} />

        <div className="chat-input-container">
          <input
            type="text"
            className="chat-input"
            placeholder={isVoiceActive ? 'Voice active — speak or type…' : 'Type your message…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            className="send-button"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            ➤
          </button>
          <button
            className={`voice-button ${isVoiceActive ? 'voice-active' : ''} ${isVoiceConnecting ? 'voice-connecting' : ''}`}
            onClick={toggleVoice}
            disabled={isVoiceConnecting}
            title={isVoiceActive ? 'Disconnect voice' : 'Start voice mode'}
          >
            {isVoiceConnecting ? '⏳' : isVoiceActive ? '🔴' : '🎙️'}
          </button>
        </div>
      </div>
    </div>
  );
}
