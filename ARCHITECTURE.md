# Smart Scheduler AI — Architecture & Latency Profile

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                     │
│                                                                               │
│  ┌──────────────────┐   ┌──────────────────────────────────────────────────┐ │
│  │  Text Chat        │   │  Voice Mode (WebRTC + OpenAI Realtime API)      │ │
│  │  Input Box        │   │                                                  │ │
│  │  + Send           │   │  Mic ──► RTCPeerConnection ──► OpenAI Realtime  │ │
│  └──────┬────────────┘   │  Speaker ◄── Remote audio track                 │ │
│         │                │  DataChannel ◄──► session.update + events       │ │
│  ┌──────┴────────────┐   └────────────────────┬────────────────────────────┘ │
│  │  Settings Panel   │                        │                              │
│  │  (Working Hours)  │                        │                              │
│  └───────────────────┘                        │                              │
│                                               │                              │
│  ┌────────────────────────────────────────────┴───────────────────────────┐  │
│  │                        Chat UI (page.tsx)                               │  │
│  │  • MessageBubble with clickable slot cards + event cards               │  │
│  │  • Streaming transcript accumulator (assistantTranscriptRef)           │  │
│  │  • User placeholder pattern (speech_started → fill on transcription)   │  │
│  │  • pendingSlotsRef / pendingEventsRef merge into spoken msg            │  │
│  │  • Auth status display (user email, logout)                            │  │
│  │  • Working hours settings (gear icon, localStorage persistence)        │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
              │ Text                         │ Voice tool calls
              ▼                              ▼
┌───────────────────────────┐
│  Edge Middleware           │
│  (HMAC cookie validation) │
│  middleware.ts             │
└──────────┬────────────────┘
           ▼
┌──────────────────────┐      ┌──────────────────────────────┐
│  POST /api/chat      │      │  POST /api/realtime/tools    │
│  (text chat pipeline)│      │  (voice tool execution)      │
│                      │      │                              │
│  1. Resolve user auth│      │  1. Resolve user auth        │
│  2. Redis session    │      │  2. Redis session load       │
│  3. Slot extraction  │      │  3. Execute tool             │
│  4. Auto-search      │      │  4. Redis session save       │
│  5. LLM agentic loop│      │  5. Return result → DC       │
│     (up to 8 iters)  │      └──────────────────────────────┘
│  6. Redis save       │
│  7. Return response  │
└──────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────┐
│                    Shared Backend Libraries                      │
│                                                                 │
│  lib/auth/       cookie.ts, tokens.ts, resolve.ts              │
│  lib/calendar/   auth.ts, freebusy.ts, events.ts, utils.ts    │
│  lib/agent/      prompt.ts, tools.ts, slot-filler.ts,          │
│                  conflict-resolver.ts, state.ts                │
│  lib/session/    store.ts (Upstash Redis)                      │
│  lib/debug.ts    DebugLogger                                   │
└────────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────┐          ┌──────────────────────┐
│ Google Calendar   │          │ Upstash Redis        │
│ API v3            │          │ (sessions + tokens)  │
│ (per-user OAuth)  │          │                      │
└──────────────────┘          └──────────────────────┘
```

## Authentication Flow

```
Browser                      Server                         Google
  │                            │                               │
  ├── GET /api/auth/login ────►│                               │
  │                            ├── Generate OAuth URL ────────►│
  │◄── 302 Redirect ──────────┤                               │
  │                            │                               │
  ├── User signs in ──────────────────────────────────────────►│
  │◄── Redirect to /api/auth/callback?code=... ───────────────┤
  │                            │                               │
  ├── GET /api/auth/callback ─►│                               │
  │                            ├── Exchange code for tokens ──►│
  │                            │◄── access_token + refresh ────┤
  │                            ├── Fetch userinfo.email ──────►│
  │                            │◄── email ─────────────────────┤
  │                            ├── Store tokens in Redis       │
  │                            ├── Set HMAC-signed cookie      │
  │◄── 302 Redirect to / ─────┤                               │
  │                            │                               │
  ├── Subsequent API calls ───►│                               │
  │   (cookie attached)        ├── Verify HMAC signature       │
  │                            ├── Load tokens from Redis      │
  │                            ├── Create OAuth2Client         │
  │                            ├── withCalendarAuth(AsyncLocal) │
  │                            ├── Calendar operations ───────►│
  │                            │◄── Results ───────────────────┤
  │◄── Response ───────────────┤                               │
```

### Key Auth Design Decisions

- **Edge Middleware** (`middleware.ts`): Uses Web Crypto API (not Node `crypto`) for HMAC verification, compatible with Vercel Edge Runtime
- **AsyncLocalStorage**: Per-user OAuth2Client is threaded through all calendar operations via `AsyncLocalStorage`, avoiding changes to function signatures throughout the call chain
- **Fallback**: When `SESSION_SECRET` is not set, middleware passes all requests through (backward-compatible dev mode using `.env.local` refresh token)

## Two Communication Pipelines

### 1. Text Chat Pipeline (`POST /api/chat`)

User types a message → frontend sends it to `/api/chat`:

1. **Auth resolution** — Cookie → Redis token lookup → OAuth2Client via AsyncLocalStorage
2. **Session load** — Upstash Redis, ~50ms
3. **Slot extraction** — Rule-based regex (duration, day, time window, attendees), <1ms
4. **Auto-search** — If all 3 slots filled and no fresh results, runs `find_free_slots` preemptively (saves an LLM round-trip)
5. **System prompt build** — Injects conversation history (last 20 messages), working hours, collected slots, calendar results, conflict handling instructions
6. **LLM agentic loop** — gpt-4o-mini with tool schemas; loops up to 8 times for multi-tool calls (supports multi-booking)
7. **VOICE: tag extraction** — LLM embeds a spoken summary; fallback to rule-based generation
8. **Session save** — Redis, ~50ms

### 2. Voice Pipeline (WebRTC + OpenAI Realtime API)

User clicks mic → browser opens WebRTC connection to OpenAI:

1. **Token mint** — `POST /api/realtime/session` → OpenAI `/v1/realtime/client_secrets` → ephemeral token
2. **WebRTC setup** — `RTCPeerConnection` + local mic track + DataChannel
3. **SDP exchange** — `POST https://api.openai.com/v1/realtime/calls` with offer SDP
4. **Session config** — `session.update` sent on DataChannel open (instructions, tools, VAD config, working hours)
5. **Conversation** — Model streams audio + transcript deltas via DataChannel events
6. **Tool calls** — `response.function_call_arguments.done` → `POST /api/realtime/tools` → result sent back via DC

**Model:** `gpt-realtime-mini` (voice), `gpt-4o-mini` (text)

## Voice DataChannel Event Flow

```
speech_started ──► Push user placeholder "…" to chat
                   (ensures user msg appears before bot response)

transcription.completed ──► Fill placeholder with actual text

response.audio_transcript.delta ──► Stream assistant text into chat

response.function_call_arguments.done ──► Execute tool via /api/realtime/tools
                                          Stash slots/events in pendingRef

response.audio_transcript.done ──► Merge pendingSlotsRef/pendingEventsRef
                                   into final message (single representation)

response.done ──► Reset accumulators
```

## Tools (6 total)

| Tool | Pipeline | Purpose |
|------|----------|---------|
| `find_next_slot` | Voice only | ASAP booking — queries 3 days in parallel |
| `find_free_slots` | Both | Find slots for a specific day/window |
| `create_event` | Both | Book a meeting on Google Calendar |
| `list_events` | Both | Show calendar events for a date range |
| `lookup_event` | Both | Search for an event by name |
| `delete_event` | Both | Delete an event (for reschedule/cancel flows) |

## Conflict Resolution

When `find_free_slots` returns empty:

1. **Fetch blocking events** — `listEvents` on the same window to show the user what's in the way
2. Three fallback strategies run **in parallel** via `Promise.all`:
   - **Expand time window** — Same day, full working hours range
   - **Adjacent days** — ±1 day, same time window (both queried in parallel)
   - **Next weekdays** — Up to 3 upcoming weekdays, all queried in parallel
3. First strategy with results wins
4. Both blocking events AND alternatives are included in the tool result for the LLM

The LLM is instructed to follow a 3-step response pattern:
1. Show the blocker ("Tuesday afternoon is blocked by Team Standup 2-3 PM and Design Review 3-4:30 PM")
2. Offer alternatives ("But Wednesday morning is open — here are some options:")
3. If no alternatives: suggest next steps ("Want me to check mornings instead, or try next week?")

## Prompt Engineering

### System Prompt (`lib/agent/prompt.ts`)

The system prompt is rebuilt on every request with dynamic state injection:

- **Date reference** — Today, tomorrow, day-after-tomorrow with timezone-correct formatting
- **Working hours** — From user's UI settings, respected in all searches
- **Conversation history** — Last 20 messages summarized and injected
- **Collected slots** — Current duration/day/window/attendees state
- **Calendar results** — Last search results or "STALE" indicator
- **Behavioral rules** — Multi-booking batch, automatic cancel/reschedule, conflict handling pattern, ASAP mapping

### Voice Prompt (`buildSessionConfig` in `page.tsx`)

Inline prompt with the same behavioral rules, timezone-correct dates using `toLocaleDateString('en-CA', { timeZone })`, and working hours section.

## UI Components

### Settings Panel
Gear icon in the header opens a dropdown with two `<select>` dropdowns for start/end working hours. Values are persisted to `localStorage` and sent with every API request.

### Auth Display
Header shows the authenticated user's email and a logout button. Auth status is checked on mount via `/api/auth/status`.

### Slot Picker Cards
When `find_free_slots` or `find_next_slot` returns results, they appear as interactive cards with a numbered circle, time display, and "Book" hover hint. Clicking a card sends a confirmation message.

### Event Cards
When `list_events` returns results, they appear as read-only cards with event name and time. Same visual style as slot cards but not clickable.

### Duplicate Prevention
Voice mode uses the `pendingSlotsRef`/`pendingEventsRef` pattern: tool results are stashed in a ref, then merged into the model's spoken transcript message when it finalizes. This prevents both the model's text and separate cards from appearing.

## Latency Optimizations Applied

1. **WebRTC Realtime API** — Eliminates separate STT + TTS pipeline entirely
2. **Server VAD** — `silence_duration_ms: 800` (reduced from 1500), `threshold: 0.6`
3. **Parallel Calendar queries** — `find_next_slot` queries 3 days via `Promise.all`
4. **Parallel conflict resolution** — All 3 strategies + adjacent days run concurrently
5. **Auto-search** — Text pipeline pre-runs `find_free_slots` when all slots filled (saves 1 LLM round-trip)
6. **Rule-based slot extraction** — Regex, <1ms (no LLM call needed)
7. **Text shown immediately** — Not blocked by audio generation

## Performance Instrumentation

All server-side and client-side operations are instrumented with `[PERF]` prefixed console.log timers:

| Tag | What it measures |
|-----|-----------------|
| `[PERF][session]` | Redis getSession / saveSession / deleteSession |
| `[PERF][calendar]` | getCalendarClient, freebusy.query, findFreeSlots, createEvent, listEvents, deleteEvent, lookupEvent |
| `[PERF][conflict]` | resolveConflict total + parallel strategies |
| `[PERF][slot-filler]` | extractAndUpdateSlots |
| `[PERF][chat]` | Total request, session load, slot extraction, auto-search, LLM calls, agentic loop, session save |
| `[PERF][realtime/session]` | Token mint + OpenAI fetch |
| `[PERF][realtime/tools]` | Tool execution + total handler |
| `[PERF][client]` | Text chat round-trip, voice tool round-trip, token fetch, SDP exchange, voice connection total |

## Key Files

| File | Role |
|------|------|
| `middleware.ts` | Edge auth — HMAC cookie verification, route protection |
| `app/api/auth/login/route.ts` | Google OAuth redirect |
| `app/api/auth/callback/route.ts` | Token exchange, Redis storage, cookie set |
| `app/api/auth/logout/route.ts` | Clear tokens + cookie |
| `app/api/auth/status/route.ts` | Auth status check (email + authenticated flag) |
| `app/page.tsx` | Main UI — text chat, WebRTC voice, settings, auth display |
| `app/api/chat/route.ts` | Text chat orchestrator — slot extraction, LLM loop, tool execution |
| `app/api/realtime/session/route.ts` | Mints ephemeral WebRTC token |
| `app/api/realtime/tools/route.ts` | Executes tool calls from Realtime API |
| `lib/auth/cookie.ts` | HMAC-signed session cookie management |
| `lib/auth/tokens.ts` | Per-user OAuth token storage in Redis |
| `lib/auth/resolve.ts` | Resolves current user's OAuth2Client from cookie |
| `lib/agent/prompt.ts` | System prompt builder with conversation context, working hours, conflict rules |
| `lib/agent/tools.ts` | LLM tool schemas (text pipeline) |
| `lib/agent/slot-filler.ts` | Rule-based NLU — duration, day, time window, attendee extraction |
| `lib/agent/conflict-resolver.ts` | 3-strategy parallel fallback with blocking event detection |
| `lib/agent/state.ts` | ConversationState management + reducers |
| `lib/calendar/auth.ts` | OAuth2 client creation + AsyncLocalStorage threading |
| `lib/calendar/freebusy.ts` | Google Calendar freebusy queries |
| `lib/calendar/events.ts` | createEvent, listEvents, deleteEvent, lookupEvent |
| `lib/calendar/utils.ts` | Time window bounds (working-hours-aware), slot formatting |
| `lib/session/store.ts` | Upstash Redis session CRUD |
| `lib/debug.ts` | Structured debug logger |
| `components/ChatWindow.tsx` | Message container with auto-scroll |
| `components/MessageBubble.tsx` | Message bubble with slot cards + event cards |

## Latency Breakdown (Estimated)

| Stage | Time | Blocking? |
|-------|------|-----------|
| Auth resolution (cookie + Redis) | ~60ms | Yes |
| Redis load (Upstash) | ~50ms | Yes |
| Slot extraction (regex) | <1ms | Yes |
| Auto-search (Google Calendar FreeBusy) | ~300-500ms | Yes (only when all slots filled) |
| LLM (gpt-4o-mini, 1 turn) | ~1.5s | Yes |
| LLM (with tool call + 2nd turn) | ~3s | Yes |
| Redis save | ~50ms | Yes |
| **Total text chat API** | **~2-3.5s** | — |
| Voice token mint | ~500ms | One-time at connection |
| SDP exchange | ~500ms | One-time at connection |
| Voice tool round-trip | ~500-1500ms | Yes (during tool call) |
