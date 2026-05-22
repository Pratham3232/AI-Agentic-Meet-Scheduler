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
│  │  • Booking progress bar + day rail (BookingProgress, BookingDayRail)   │  │
│  │  • Cancel progress bar + day rail (CancelProgress)                     │  │
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
│  3. Slot extraction  │      │  3. Execute tool (12 tools)  │
│  4. Auto-search      │      │  4. Redis session save       │
│  5. LLM agentic loop│      │  5. Return result → DC       │
│     (up to 8 iters,  │      └──────────────────────────────┘
│      12 tools)       │
│  6. Redis save       │
│  7. Return response  │
└──────────────────────┘
              │
              ▼
┌──────────────────────┐      ┌──────────────────────────────┐
│  POST /api/booking/* │      │  POST /api/cancel/*          │
│  run: SSE-streamed   │      │  run: SSE-streamed           │
│       batch booking  │      │       batch cancel           │
│  progress: polling   │      │  progress: polling           │
└──────────────────────┘      └──────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────┐
│                    Shared Backend Libraries                      │
│                                                                 │
│  lib/auth/       cookie.ts, tokens.ts, resolve.ts              │
│  lib/calendar/   auth.ts, freebusy.ts, events.ts, utils.ts,   │
│                  slot-search.ts                                 │
│  lib/agent/      prompt.ts, prompt-shared.ts, tools.ts,        │
│                  slot-filler.ts, state.ts,                      │
│                  conflict-resolver.ts, find-slots.ts,           │
│                  multi-booking.ts, multi-day-plan.ts,           │
│                  booking-executor.ts, booking-context.ts,       │
│                  booking-days.ts, booking-progress.ts,          │
│                  booking-sse.ts, cancel-executor.ts,            │
│                  cancel-context.ts, cancel-progress.ts,         │
│                  event-matcher.ts, event-cache.ts, job-sse.ts  │
│  lib/session/    store.ts (Upstash Redis)                      │
│  lib/client/     booking-progress-ui.ts,                       │
│                  cancel-progress-ui.ts,                         │
│                  realtime-response-gate.ts                      │
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

- **OAuth Scopes**: Uses `calendar.events` + `calendar.readonly` + `userinfo.email` (sensitive, not restricted) — avoids Google's verification requirement for the full `calendar` scope
- **Edge Middleware** (`middleware.ts`): Uses Web Crypto API (not Node `crypto`) for HMAC verification, compatible with Vercel Edge Runtime
- **AsyncLocalStorage**: Per-user OAuth2Client is threaded through all calendar operations via `AsyncLocalStorage`, avoiding changes to function signatures throughout the call chain
- **Fallback**: When `SESSION_SECRET` is not set, middleware passes all requests through (backward-compatible dev mode using `.env.local` refresh token)
- **Published App**: Any Google user can sign in without being added as a test user. Unverified app warning is shown but users can proceed via Advanced → Continue

## Two Communication Pipelines

### 1. Text Chat Pipeline (`POST /api/chat`)

User types a message → frontend sends it to `/api/chat`:

1. **Auth resolution** — Cookie → Redis token lookup → OAuth2Client via AsyncLocalStorage
2. **Session load** — Upstash Redis, ~50ms
3. **Slot extraction** — Rule-based regex (duration, day, time window, preferred start/end, attendees), <1ms
4. **Auto-search** — If all 3 slots filled and no fresh results, runs `find_free_slots` preemptively (saves an LLM round-trip)
5. **System prompt build** — Injects conversation history (last 20 messages), working hours, collected slots, calendar results, booking/cancel job status, event cache, pending reschedule state, conflict handling instructions, shared behavioral rules
6. **LLM agentic loop** — gpt-4o-mini with 12 tool schemas; loops up to 8 times for multi-tool calls (supports multi-booking, batch cancel, rescheduling)
7. **VOICE: tag extraction** — LLM embeds a spoken summary; fallback to rule-based generation
8. **Session save** — Redis, ~50ms

### 2. Voice Pipeline (WebRTC + OpenAI Realtime API)

User clicks mic → browser opens WebRTC connection to OpenAI:

1. **Token mint** — `POST /api/realtime/session` → OpenAI `/v1/realtime/client_secrets` → ephemeral token
2. **WebRTC setup** — `RTCPeerConnection` + local mic track + DataChannel
3. **SDP exchange** — `POST https://api.openai.com/v1/realtime/calls` with offer SDP
4. **Session config** — `session.update` sent on DataChannel open (instructions, tools, VAD config, working hours, shared behavioral rules)
5. **Conversation** — Model streams audio + transcript deltas via DataChannel events
6. **Tool calls** — `response.function_call_arguments.done` → `POST /api/realtime/tools` → result sent back via DC

**Model:** `gpt-realtime-mini` (voice), `gpt-4o-mini` (text)

### 3. Batch Job Pipelines (SSE)

For multi-day bookings and bulk cancellations, the system uses a job-based architecture:

```
LLM                    Client                    Server
 │                       │                         │
 ├─ init_booking_job ───►│                         │
 │  (creates job)        │                         │
 ├─ execute_booking_batch│                         │
 │  (books first ≤5)     │                         │
 │                       │                         │
 │  ◄── response ────────┤                         │
 │                       ├── POST /api/booking/run►│
 │                       │   (SSE stream)          ├── Book remaining items
 │                       │◄── event: progress ─────┤   one by one
 │                       │◄── event: progress ─────┤
 │                       │◄── event: done ─────────┤
 │                       │                         │
 │                       ├── GET /api/booking/     │
 │                       │   progress (polling) ──►│
 │                       │◄── snapshot ────────────┤
```

Same pattern applies to `/api/cancel/run` and `/api/cancel/progress`.

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

## Tools (12 total)

| Tool | Pipeline | Purpose |
|------|----------|---------|
| `find_free_slots` | Both | Find slots for a specific day/window with optional preferred time (proximity-ranked) |
| `plan_multi_day_bookings` | Both | Resolve day patterns and check conflicts across multiple days |
| `init_booking_job` | Both | Initialize a batch booking job after user confirms plan |
| `execute_booking_batch` | Both | Execute next batch of pending bookings (SSE continues the rest) |
| `init_cancel_job` | Both | Initialize bulk cancellation job |
| `execute_cancel_batch` | Both | Execute next batch of cancellations (SSE continues the rest) |
| `create_event` | Both | Book a single meeting on Google Calendar |
| `list_events` | Both | List calendar events for a date range (paginated) |
| `identify_event` | Both | Find events by time hint and/or title (for reschedule/cancel) |
| `reschedule_event` | Both | Move an event to a new time (preview mode or execute mode) |
| `lookup_event` | Both | Search for an event by name |
| `delete_event` | Both | Delete a single event by ID |

## Conflict Resolution

When `find_free_slots` returns empty:

1. **Fetch blocking events** — `listEvents` on the same window to show the user what's in the way
2. Three fallback strategies run **in parallel** via `Promise.all`:
   - **Expand time window** — Same day, full working hours range
   - **Adjacent days** — ±1 day, same time window (both queried in parallel)
   - **Next weekdays** — Up to 3 upcoming weekdays, all queried in parallel
3. First strategy with results wins
4. Both blocking events AND alternatives are included in the tool result for the LLM

**Proximity Ranking**: When the user names a specific time (e.g., "10 AM"), alternatives are sorted by proximity — nearest times first (9:30, 10:30, 9:00, 11:00) rather than chronologically from morning.

The LLM follows a 3-step response pattern:
1. Show the blocker ("Tuesday afternoon is blocked by Team Standup 2-3 PM and Design Review 3-4:30 PM")
2. Offer alternatives ("But Wednesday morning is open — here are some options:")
3. If no alternatives: suggest next steps ("Want me to check mornings instead, or try next week?")

## Smart Rescheduling

```
User: "Move my 4-7 PM meeting to tomorrow"
  │
  ├── identify_event(timeHint: "4-7 PM")
  │   └── Matches against cached calendar or fetches fresh
  │       └── Single match → bestMatch
  │       └── Multiple → numbered list for disambiguation
  │
  ├── reschedule_event(confirmed: false)  ← Preview mode
  │   └── "Move Design Review from Thu 4-7 PM to Fri 4-7 PM?"
  │
  └── reschedule_event(confirmed: true)   ← Execute mode
      └── Delete old event + create new one atomically
      └── Track lastRescheduledEvent for follow-up queries
```

## Event Caching

- `cachedCalendar` on `ConversationState` stores a time-range snapshot of calendar events
- `calendarVersion` counter invalidated on create/delete/reschedule operations
- Used by `identify_event` and `reschedule_event` to avoid redundant API calls
- `updateEventCache` and `invalidateEventCache` maintain consistency

## Prompt Engineering

### System Prompt (`lib/agent/prompt.ts`)

The system prompt is rebuilt on every request with dynamic state injection:

- **Date reference** — Today, tomorrow, day-after-tomorrow with timezone-correct formatting
- **Working hours** — From user's UI settings, respected in all searches
- **Conversation history** — Last 20 messages summarized and injected via `buildConversationContext()`
- **Collected slots** — Current duration/day/window/attendees/preferredStart/preferredEnd state
- **Calendar results** — Last search results or "STALE" indicator
- **Booking job status** — Current `BookingJob` progress injected via `buildBookingJobPromptBlock()`
- **Cancel job status** — Current `CancelJob` progress injected via `buildCancelJobPromptBlock()`
- **Event cache** — Cached calendar snapshot for fast re-queries
- **Pending reschedule** — Tracks in-progress reschedule for confirmation flow
- **Last rescheduled event** — Context for follow-up queries after reschedule

### Shared Behavioral Rules (`lib/agent/prompt-shared.ts`)

Rules shared between text and voice prompts:

| Rule | Purpose |
|------|---------|
| `CONFLICT_HANDLING_RULES` | Show blocker first, then proximity-ranked alternatives |
| `PROXIMITY_SLOT_RULES` | Nearest-first ordering, not chronological |
| `WORKING_HOURS_POLICY` | Soft default — explicit times bypass restrictions |
| `MULTI_DAY_BOOKING_RULES` | Plan → confirm → init → batch flow |
| `BULK_CANCEL_RULES` | List → confirm count → init → batch flow |
| `RESCHEDULE_WORKFLOW_RULES` | Identify → preview → confirm → execute |
| `MULTI_BOOKING_GAP_RULES` | Gap = free time between meetings |
| `ASYNC_PROMISE_BAN` | Never promise async follow-up |

### Voice Prompt (`buildSessionConfig` in `page.tsx`)

Inline prompt with the same shared behavioral rules, timezone-correct dates using `toLocaleDateString('en-CA', { timeZone })`, and working hours section.

## UI Components

### Settings Panel
Gear icon in the header opens a dropdown with two `<select>` dropdowns for start/end working hours. Values are persisted to `localStorage` and sent with every API request.

### Auth Display
Header shows the authenticated user's email and a logout button. Auth status is checked on mount via `/api/auth/status`.

### Slot Picker Cards
When `find_free_slots` returns results, they appear as interactive cards with a numbered circle, time display, and "Book" hover hint. Clicking a card sends a confirmation message.

### Event Cards
When `list_events` returns results, they appear as read-only cards with event name and time. Same visual style as slot cards but not clickable.

### Booking Progress Bar (`BookingProgress`)
Displays real-time progress for multi-day batch bookings. Shows total/booked/failed counts with a progress bar. Includes `BookingDayRail` showing per-day status indicators (pending/booked/failed/skipped).

### Cancel Progress Bar (`CancelProgress`)
Same pattern as booking progress for bulk cancel operations.

### BookingDayRail
Per-day status rail showing colored indicators for each day in a batch job. Color-coded: pending (gray), booked/cancelled (green), failed (red), skipped (yellow).

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
8. **Event caching** — Server-side calendar snapshots avoid redundant API calls within a session
9. **SSE batch execution** — Client-driven progress avoids LLM tool-call bottleneck for multi-day operations

## Performance Instrumentation

All server-side and client-side operations are instrumented with `[PERF]` prefixed console.log timers:

| Tag | What it measures |
|-----|-----------------|
| `[PERF][session]` | Redis getSession / saveSession / deleteSession |
| `[PERF][calendar]` | getCalendarClient, freebusy.query, findFreeSlots, createEvent, listEvents, deleteEvent, lookupEvent, patchEvent, getEventById |
| `[PERF][conflict]` | resolveConflict total + parallel strategies |
| `[PERF][slot-filler]` | extractAndUpdateSlots |
| `[PERF][chat]` | Total request, session load, slot extraction, auto-search, LLM calls, agentic loop, session save |
| `[PERF][realtime/session]` | Token mint + OpenAI fetch |
| `[PERF][realtime/tools]` | Tool execution + total handler |
| `[PERF][booking]` | Batch booking execution, SSE stream, progress computation |
| `[PERF][cancel]` | Batch cancel execution, SSE stream, progress computation |
| `[PERF][client]` | Text chat round-trip, voice tool round-trip, token fetch, SDP exchange, voice connection total |

## Key Files

| File | Role |
|------|------|
| `middleware.ts` | Edge auth — HMAC cookie verification, route protection |
| `app/api/auth/login/route.ts` | Google OAuth redirect |
| `app/api/auth/callback/route.ts` | Token exchange, Redis storage, cookie set (maxDuration: 10s) |
| `app/api/auth/logout/route.ts` | Clear tokens + cookie |
| `app/api/auth/status/route.ts` | Auth status check (email + authenticated flag) |
| `app/page.tsx` | Main UI — text chat, WebRTC voice, settings, auth display, progress bars |
| `app/api/chat/route.ts` | Text chat orchestrator — slot extraction, LLM loop, 12 tools (maxDuration: 30s) |
| `app/api/realtime/session/route.ts` | Mints ephemeral WebRTC token (maxDuration: 10s) |
| `app/api/realtime/tools/route.ts` | Executes tool calls from Realtime API, 12 tools (maxDuration: 15s) |
| `app/api/booking/run/route.ts` | SSE-streamed batch booking execution |
| `app/api/booking/progress/route.ts` | Booking job progress snapshot |
| `app/api/cancel/run/route.ts` | SSE-streamed batch cancel execution |
| `app/api/cancel/progress/route.ts` | Cancel job progress snapshot |
| `lib/auth/cookie.ts` | HMAC-signed session cookie management |
| `lib/auth/tokens.ts` | Per-user OAuth token storage in Redis (30-day TTL) |
| `lib/auth/resolve.ts` | Resolves current user's OAuth2Client from cookie |
| `lib/agent/prompt.ts` | System prompt builder with dynamic state injection |
| `lib/agent/prompt-shared.ts` | Shared behavioral rules (conflict, booking, cancel, reschedule) |
| `lib/agent/tools.ts` | LLM tool schemas (12 tools) |
| `lib/agent/slot-filler.ts` | Rule-based NLU — duration, day, time window, preferred time, attendee extraction |
| `lib/agent/find-slots.ts` | Slot search with preferred-time proximity ranking |
| `lib/agent/conflict-resolver.ts` | 3-strategy parallel fallback with blocking event detection |
| `lib/agent/state.ts` | ConversationState management + reducers |
| `lib/agent/multi-booking.ts` | Multi-day booking planner (day resolution, conflict checking) |
| `lib/agent/multi-day-plan.ts` | Plan building utilities (initEntries, fingerprints) |
| `lib/agent/booking-executor.ts` | Batch booking job execution (init, execute, progress) |
| `lib/agent/booking-context.ts` | Booking job state → prompt block injection |
| `lib/agent/booking-days.ts` | Day resolution + fingerprinting utilities |
| `lib/agent/booking-progress.ts` | Progress snapshot computation |
| `lib/agent/booking-sse.ts` | SSE lock management for booking jobs |
| `lib/agent/cancel-executor.ts` | Batch cancel job execution |
| `lib/agent/cancel-context.ts` | Cancel job state → prompt block injection |
| `lib/agent/cancel-progress.ts` | Cancel progress snapshot computation |
| `lib/agent/event-matcher.ts` | Smart event identification + reschedule execution |
| `lib/agent/event-cache.ts` | Server-side calendar snapshot + pending reschedule tracking |
| `lib/agent/job-sse.ts` | Shared SSE lock utilities |
| `lib/agent/time-parser.ts` | Time parsing utilities |
| `lib/calendar/auth.ts` | OAuth2 client creation + AsyncLocalStorage threading |
| `lib/calendar/freebusy.ts` | Google Calendar freebusy queries (gap-walking algorithm) |
| `lib/calendar/events.ts` | CRUD: createEvent, listEvents, listEventsPaginated, deleteEvent, lookupEvent, getEventById, patchEvent |
| `lib/calendar/utils.ts` | Time window bounds (working-hours-aware), slot formatting |
| `lib/calendar/slot-search.ts` | isSlotFree, filterFutureSlots, eventsOverlappingRange |
| `lib/client/booking-progress-ui.ts` | Client-side booking progress SSE handler |
| `lib/client/cancel-progress-ui.ts` | Client-side cancel progress SSE handler |
| `lib/client/realtime-response-gate.ts` | Voice response gating utility |
| `lib/session/store.ts` | Upstash Redis session CRUD |
| `lib/debug.ts` | Structured debug logger |
| `components/ChatWindow.tsx` | Message container with auto-scroll |
| `components/MessageBubble.tsx` | Message bubble with slot cards + event cards |
| `components/VoiceButton.tsx` | Voice toggle button |
| `components/BookingProgress.tsx` | Batch booking progress bar + status |
| `components/CancelProgress.tsx` | Batch cancel progress bar + status |
| `components/BookingDayRail.tsx` | Per-day status rail (pending/booked/failed indicators) |

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
| Batch booking (per item) | ~300-500ms | No (SSE-streamed) |
| Batch cancel (per item) | ~200-400ms | No (SSE-streamed) |
