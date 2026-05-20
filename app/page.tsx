'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import ChatWindow from '@/components/ChatWindow';

type SlotOption = { display: string; start: string; end: string };
type EventItem = { id: string; summary: string; display: string };
type Message = { role: string; content: string; slots?: SlotOption[]; events?: EventItem[] };

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

  const pcRef          = useRef<RTCPeerConnection | null>(null);
  const dcRef          = useRef<RTCDataChannel | null>(null);
  const audioElRef     = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Streaming transcript accumulators
  const assistantTranscriptRef = useRef<string>('');
  const assistantMsgIndexRef   = useRef<number>(-1);
  // Index of the user placeholder pushed on speech_started; filled when transcript arrives
  const userMsgIndexRef        = useRef<number>(-1);
  // Tool result data stashed here, then merged into the model's next spoken transcript
  const pendingSlotsRef        = useRef<SlotOption[] | null>(null);
  const pendingEventsRef       = useRef<EventItem[] | null>(null);

  const timezone = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';

  // ── Text chat (existing pipeline) ─────────────────────────────────────────
  const sendTextMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setIsLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, timezone }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const assistantMsg: Message = { role: 'assistant', content: data.message };
      if (data.slots?.length) assistantMsg.slots = data.slots;
      if (data.events?.length) assistantMsg.events = data.events;
      setMessages(prev => [...prev, assistantMsg]);
      if (data.sessionId && !sessionId) setSessionId(data.sessionId);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sessionId, timezone]);

  // ── Handle tool calls from Realtime API ────────────────────────────────────
  const handleRealtimeToolCall = useCallback(async (callId: string, toolName: string, args: string) => {
    console.log('[Realtime][Tool] Executing:', toolName, args);
    try {
      const parsedArgs = JSON.parse(args);
      const res = await fetch('/api/realtime/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args: parsedArgs, sessionId, timezone }),
      });
      const data = await res.json();
      console.log('[Realtime][Tool] Result:', JSON.stringify(data.result).slice(0, 200));
      if (data.sessionId && !sessionId) setSessionId(data.sessionId);

      // Stash tool result data — merged into the model's next spoken transcript
      // so only ONE representation appears in chat (cards), not two.
      if ((toolName === 'find_free_slots' || toolName === 'find_next_slot') && data.result?.slots?.length) {
        pendingSlotsRef.current = data.result.slots;
      } else if (toolName === 'list_events' && data.result?.events?.length) {
        pendingEventsRef.current = data.result.events;
      } else if (toolName === 'create_event' && data.result?.success === false) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${data.result.error}`,
        }]);
      }

      const dc = dcRef.current;
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(data.result),
          },
        }));
        dc.send(JSON.stringify({ type: 'response.create' }));
      }
    } catch (err) {
      console.error('[Realtime][Tool] Error:', err);
      pendingSlotsRef.current = null;
      pendingEventsRef.current = null;
      const dc = dcRef.current;
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ error: 'Tool execution failed' }),
          },
        }));
        dc.send(JSON.stringify({ type: 'response.create' }));
      }
    }
  }, [sessionId, timezone]);

  // ── Build session config for GA Realtime API ───────────────────────────────
  const buildSessionConfig = useCallback(() => {
    const now      = new Date();
    const today    = now.toISOString().slice(0, 10);
    const dayName  = now.toLocaleDateString('en-US', { weekday: 'long' });
    const timeStr  = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });

    return {
      type: 'realtime',
      instructions: `You are a warm, sharp voice scheduling assistant. You speak naturally, handle all calendar requests fluently, and never miss information the user already gave you.

Current time: ${timeStr} on ${dayName}, ${today}. User timezone: ${timezone}. The backend enforces all time constraints — never worry about past times yourself.

━━━ INTENT RECOGNITION ━━━

BOOK A MEETING — "schedule", "book", "set up", "find time", "arrange", "block time", "when am I free", etc.
You need: duration + intent (ASAP OR a specific day/window).

  ASAP — "ASAP", "as soon as possible", "soonest", "right now", "urgent", "today if possible", "next available":
    → Call find_next_slot(duration). Only ask for duration if truly missing. NEVER ask for a day or time window.

  SPECIFIC TIME — "tomorrow", "Monday", "next Tuesday", "this Friday afternoon", "next week morning":
    → Resolve the day to YYYY-MM-DD. If no window stated, default timeWindow="anytime".
    → Call find_free_slots(duration, day, timeWindow).

  Duration clues: "30 min" / "half an hour" / "quick call" / "brief" → 30 min.
    "an hour" / "one hour" / "60 min" → 60 min. "90 min" / "hour and a half" → 90 min. "two hours" → 120 min.
    If duration is missing: ask exactly — "How long should the meeting be?"

CHECK CALENDAR — "what's on my calendar", "what do I have", "my schedule", "show my meetings", "am I free", "what's booked", "show again", etc.
  → ALWAYS call list_events — even if you already have results from a previous call. Never recite events from memory.
  → Use appropriate range:
      "today" → today's full day in UTC.
      "tomorrow" → next day.
      "this week" → next 7 days.
      "next Monday" / "Friday" → that specific day.
  → Report clearly: event name + time. If nothing is booked, say so warmly.

RESCHEDULE / MOVE — "reschedule", "move", "change the time", "push back", "shift", etc.
  → First identify the event: use list_events or lookup_event to find it and get its ID.
  → Then call delete_event(eventId) to remove the old one.
  → Then find a new slot (find_next_slot or find_free_slots) and confirm with the user.
  → Finally call create_event to book the new time.
  → Always confirm before deleting. Say: "I'll move your [event] from [old time] to [new time]. Sound good?"

CANCEL / DELETE — "cancel", "remove", "delete", "drop", "clear", etc.
  → Identify the event, confirm with the user, then call delete_event(eventId).

━━━ CONVERSATION RULES ━━━

1. Read the ENTIRE user message first. Extract every clue — duration, day, time preference, intent — before responding.
2. Never ask for something the user already stated. Never ask two things at once.
3. Once you have what you need, call the right tool immediately. Do not narrate that you are "searching" — just speak after the result arrives.
4. After a search: present up to 3 slots as a numbered list. Say the day clearly if it's not today, then the time. Keep it brief.
5. After listing slots: ask "Which one works for you?" — wait for explicit confirmation before booking.
6. On confirmation: call create_event with EXACT ISO start/end times from the tool result. Never approximate or invent times.
7. If no slots are found: say so naturally and immediately offer an alternative — different day, wider window, or different duration.
8. Meeting title: if the user did not provide one, infer a sensible default ("Team Sync", "Quick Call", "Meeting"). Confirm it when booking.
9. After a successful booking: confirm the event name, day, and time in one sentence. Offer to help with anything else.
10. If the user changes their mind mid-flow, adapt gracefully — you already know everything they told you so far.

━━━ VOICE STYLE ━━━

Speak naturally, as if on a call — short sentences, warm tone, no filler phrases.
For slot lists, name just the day and time (e.g. "Monday at 2 PM", "tomorrow at 10:30 AM") — skip UTC strings entirely.
Never say "I'm unable to" or "I'm sorry, I can't". Redirect to what you CAN do.
English only.`,
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
          description: 'Find available slots on a specific day/window. Use when user specifies a day or time preference.',
          parameters: {
            type: 'object',
            properties: {
              duration:   { type: 'number', description: 'Duration in minutes' },
              day:        { type: 'string', description: 'ISO date YYYY-MM-DD' },
              timeWindow: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'anytime'] },
            },
            required: ['duration', 'day', 'timeWindow'],
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
          name: 'lookup_event',
          description: 'Search for an event by name. Returns the event ID needed for delete_event. Use for "reschedule my standup", "cancel the kickoff", etc.',
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
          description: 'Delete a calendar event by ID. Use when rescheduling (delete old, then create new) or cancelling. Always confirm with the user before deleting.',
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
  }, [timezone]);

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
      case 'response.audio_transcript.delta':
      case 'response.output_audio_transcript.delta': {
        const delta = event.delta || '';
        if (assistantMsgIndexRef.current === -1) {
          assistantTranscriptRef.current = delta;
          setMessages(prev => {
            assistantMsgIndexRef.current = prev.length;
            return [...prev, { role: 'assistant', content: delta }];
          });
        } else {
          assistantTranscriptRef.current += delta;
          const text = assistantTranscriptRef.current;
          const idx = assistantMsgIndexRef.current;
          setMessages(prev => {
            const updated = [...prev];
            if (idx < updated.length) {
              updated[idx] = { role: 'assistant', content: text };
            }
            return updated;
          });
        }
        setIsSpeaking(true);
        break;
      }

      // Assistant audio transcript finalized (GA API event name)
      // If pending slots exist, merge them into this message so only ONE
      // representation appears (model's intro text + interactive slot cards).
      case 'response.audio_transcript.done':
      case 'response.output_audio_transcript.done': {
        const text = event.transcript?.trim();
        console.log('[Realtime][Assistant transcript done]', text?.slice(0, 100));

        const slots = pendingSlotsRef.current;
        const events = pendingEventsRef.current;
        pendingSlotsRef.current = null;
        pendingEventsRef.current = null;

        const fallback = slots?.length ? 'Here are the available slots — pick one to book:'
          : events?.length ? 'Here\'s your schedule:' : '';

        const msg: Message = {
          role: 'assistant',
          content: text || fallback,
          ...(slots?.length ? { slots } : {}),
          ...(events?.length ? { events } : {}),
        };

        if (text && assistantMsgIndexRef.current >= 0) {
          const idx = assistantMsgIndexRef.current;
          setMessages(prev => {
            const updated = [...prev];
            if (idx < updated.length) updated[idx] = msg;
            return updated;
          });
        } else if (msg.content) {
          setMessages(prev => [...prev, msg]);
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

      // Response complete
      case 'response.done': {
        console.log('[Realtime] Response done');
        setIsSpeaking(false);
        assistantTranscriptRef.current = '';
        assistantMsgIndexRef.current = -1;
        break;
      }

      // Function call complete — execute tool
      case 'response.function_call_arguments.done': {
        console.log('[Realtime][FnCall]', event.name, event.arguments?.slice(0, 100));
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
      const tokenRes = await fetch('/api/realtime/session', { method: 'POST' });
      const { token } = await tokenRes.json();
      if (!token) throw new Error('Failed to get realtime token');
      console.log('[Realtime] Got ephemeral token');

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
    userMsgIndexRef.current = -1;
    pendingSlotsRef.current = null;
    pendingEventsRef.current = null;
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
      dcRef.current.send(JSON.stringify({ type: 'response.create' }));
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
          Smart Scheduler AI
          {isVoiceActive && <span className="speaking-indicator"> {isSpeaking ? '🔊' : '🎙️'}</span>}
        </div>

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
