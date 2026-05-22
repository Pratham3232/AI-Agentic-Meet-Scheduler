# Project Structure Overview

## Complete File Tree

```
agenticMeetScheduler/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/
│   │   │   │   └── route.ts          # Google OAuth redirect (calendar.events + calendar.readonly + email scopes)
│   │   │   ├── callback/
│   │   │   │   └── route.ts          # Token exchange, email fetch, Redis store, cookie set (maxDuration: 10s)
│   │   │   ├── logout/
│   │   │   │   └── route.ts          # Clear Redis tokens + session cookie
│   │   │   └── status/
│   │   │       └── route.ts          # Auth status check (authenticated flag + email)
│   │   ├── chat/
│   │   │   └── route.ts              # Text chat orchestrator — agentic loop, 12 tools (maxDuration: 30s)
│   │   ├── realtime/
│   │   │   ├── session/
│   │   │   │   └── route.ts          # Mints ephemeral WebRTC token (maxDuration: 10s)
│   │   │   └── tools/
│   │   │       └── route.ts          # Voice tool execution (maxDuration: 15s)
│   │   ├── booking/
│   │   │   ├── run/
│   │   │   │   └── route.ts          # SSE-streamed batch booking execution
│   │   │   └── progress/
│   │   │       └── route.ts          # Booking job progress polling
│   │   └── cancel/
│   │       ├── run/
│   │       │   └── route.ts          # SSE-streamed batch cancel execution
│   │       └── progress/
│   │           └── route.ts          # Cancel job progress polling
│   ├── page.tsx                      # Main UI — chat, voice, settings, auth, progress bars
│   ├── layout.tsx                    # Root layout
│   └── globals.css                   # Global styles
│
├── lib/
│   ├── agent/
│   │   ├── state.ts                  # ConversationState management & reducers
│   │   ├── prompt.ts                 # System prompt builder with dynamic state injection
│   │   ├── prompt-shared.ts          # Shared behavioral rules (conflict, booking, cancel, reschedule)
│   │   ├── tools.ts                  # LLM tool schemas (12 tools)
│   │   ├── slot-filler.ts            # Rule-based slot extraction from messages
│   │   ├── find-slots.ts             # Slot search with preferred-time proximity ranking
│   │   ├── multi-booking.ts          # Multi-day booking planner (resolves days, checks conflicts)
│   │   ├── multi-day-plan.ts         # Plan building utilities (initEntries, fingerprints)
│   │   ├── booking-executor.ts       # Batch booking job execution (init, execute, progress)
│   │   ├── booking-context.ts        # Booking job state → prompt block injection
│   │   ├── booking-days.ts           # Day resolution + fingerprinting utilities
│   │   ├── booking-progress.ts       # Progress snapshot computation
│   │   ├── booking-sse.ts            # SSE lock management for booking jobs
│   │   ├── cancel-executor.ts        # Batch cancel job execution
│   │   ├── cancel-context.ts         # Cancel job state → prompt block injection
│   │   ├── cancel-progress.ts        # Cancel progress snapshot computation
│   │   ├── event-matcher.ts          # Smart event identification + reschedule execution
│   │   ├── event-cache.ts            # Server-side calendar snapshot + pending reschedule tracking
│   │   ├── conflict-resolver.ts      # Parallel fallback slot search (3 strategies)
│   │   ├── job-sse.ts                # Shared SSE lock utilities
│   │   └── time-parser.ts            # Time parsing utilities
│   ├── auth/
│   │   ├── cookie.ts                 # HMAC-signed session cookie management
│   │   ├── tokens.ts                 # Per-user OAuth token storage in Redis (30-day TTL)
│   │   └── resolve.ts               # Resolves current user's OAuth2Client from cookie
│   ├── calendar/
│   │   ├── auth.ts                   # Google OAuth2 client creation + AsyncLocalStorage threading
│   │   ├── freebusy.ts               # Find available time slots (gap-walking algorithm)
│   │   ├── events.ts                 # CRUD: createEvent, listEvents, listEventsPaginated, deleteEvent, lookupEvent, getEventById, patchEvent
│   │   ├── utils.ts                  # Time window bounds (working-hours-aware), slot formatting
│   │   └── slot-search.ts            # isSlotFree, filterFutureSlots, eventsOverlappingRange
│   ├── client/
│   │   ├── booking-progress-ui.ts    # Client-side booking progress SSE handler
│   │   ├── cancel-progress-ui.ts     # Client-side cancel progress SSE handler
│   │   └── realtime-response-gate.ts # Voice response gating utility
│   ├── session/
│   │   └── store.ts                  # Upstash Redis session CRUD
│   ├── debug.ts                      # Structured debug logger
│   ├── voice-script.ts               # Rule-based voice summary fallback
│   └── realtime/
│       └── session-config.ts         # Realtime session config reference
│
├── middleware.ts                      # Edge auth middleware (HMAC cookie verification, Web Crypto API)
│
├── components/
│   ├── ChatWindow.tsx                # Message container with auto-scroll
│   ├── MessageBubble.tsx             # Message bubble with slot cards + event cards
│   ├── VoiceButton.tsx               # Voice toggle button
│   ├── BookingProgress.tsx           # Batch booking progress bar + status
│   ├── CancelProgress.tsx            # Batch cancel progress bar + status
│   └── BookingDayRail.tsx            # Per-day status rail (pending/booked/failed indicators)
│
├── types/
│   └── index.ts                      # TypeScript types (ConversationState, BookingJob, CancelJob, etc.)
│
├── scripts/
│   ├── auth-google.js                # OAuth token generator (dev utility)
│   ├── diagnose-calendar.js          # Calendar diagnostics
│   └── test-api.js                   # API test script
│
├── __tests__/
│   ├── agent/
│   │   ├── state.test.ts             # State management tests
│   │   ├── slot-filler.test.ts       # Slot extraction tests
│   │   ├── booking-executor.test.ts  # Booking job lifecycle tests
│   │   ├── booking-context.test.ts   # Booking context reconciliation tests
│   │   ├── booking-days.test.ts      # Day resolution tests
│   │   ├── booking-sse.test.ts       # SSE lock tests
│   │   ├── cancel-executor.test.ts   # Cancel job tests
│   │   ├── event-matcher.test.ts     # Event identification tests
│   │   ├── event-matcher-reschedule.test.ts  # Reschedule flow tests
│   │   ├── event-cache.test.ts       # Event cache tests
│   │   ├── multi-booking.test.ts     # Multi-day planner tests
│   │   └── multi-day-plan.test.ts    # Plan building tests
│   ├── calendar/
│   │   └── slot-search.test.ts       # Slot search utility tests
│   ├── client/
│   │   ├── booking-progress-ui.test.ts  # Client progress handler tests
│   │   └── realtime-response-gate.test.ts  # Voice gate tests
│   └── components/
│       └── booking-day-rail.test.tsx  # Day rail component tests
│
├── .env.local.example                # Environment variables template
├── .gitignore
├── jest.config.js                    # Jest configuration
├── jest.setup.js                     # Jest setup file
├── next.config.js                    # Next.js configuration
├── package.json                      # Dependencies & scripts
├── tsconfig.json                     # TypeScript configuration
├── vercel.json                       # Vercel config (framework: nextjs only; timeouts via route exports)
├── README.md                         # Full project documentation
├── SETUP.md                          # Setup instructions
├── ARCHITECTURE.md                   # Architecture & latency profile
├── IMPLEMENTATION_SUMMARY.md         # Implementation checklist
└── PROJECT_STRUCTURE.md              # This file
```

## Layer Architecture

### Layer 0 — Authentication
**Files:** `middleware.ts`, `lib/auth/*`, `app/api/auth/*`

Per-user Google OAuth flow:
- OAuth scopes: `calendar.events` + `calendar.readonly` + `userinfo.email` (sensitive, not restricted)
- Edge middleware validates HMAC-signed session cookies using Web Crypto API
- OAuth callback exchanges code for tokens, stores in Redis, sets cookie
- `resolveCalendarAuth()` reads cookie → Redis tokens → creates OAuth2Client
- `withCalendarAuth()` threads the client via `AsyncLocalStorage` to all calendar operations
- Published app: any Google user can sign in (unverified warning screen with bypass)
- Fallback: when `SESSION_SECRET` is not set, all requests pass through (dev mode)

### Layer 1 — Voice I/O (WebRTC)
**Files:** `app/api/realtime/session/route.ts`, `app/page.tsx` (voice section)

Direct browser-to-OpenAI WebRTC connection via the Realtime API:
- Ephemeral token minted server-side, WebRTC connection client-side
- DataChannel carries session config, tool calls, and transcript events
- Model: `gpt-realtime-mini` with Server VAD (800ms silence, 0.6 threshold)
- Voice prompt includes timezone-aware dates, working hours, all shared behavioral rules

### Layer 2 — Orchestration Backend
**Files:** `app/api/chat/route.ts`, `app/api/realtime/tools/route.ts`, `lib/agent/*`, `lib/session/store.ts`

Two parallel pipelines sharing the same backend libraries:
- **Text pipeline** (`/api/chat`): slot extraction → auto-search → LLM agentic loop (up to 8 iterations, 12 tools)
- **Voice pipeline** (`/api/realtime/tools`): direct tool execution, result sent back via DataChannel
- Both pipelines wrapped in `runWithAuth` for per-user calendar access

### Layer 3 — Batch Job Execution
**Files:** `lib/agent/booking-executor.ts`, `lib/agent/cancel-executor.ts`, `app/api/booking/*`, `app/api/cancel/*`, `lib/client/*`

Job-based architecture for multi-day operations:
- LLM initializes job + executes first batch (≤5 items)
- Client SSE handler (`/api/booking/run`, `/api/cancel/run`) streams remaining items
- Progress polling via `/api/booking/progress`, `/api/cancel/progress`
- UI components (`BookingProgress`, `CancelProgress`, `BookingDayRail`) show real-time status

### Layer 4 — LLM Brain
**Files:** `lib/agent/prompt.ts`, `lib/agent/prompt-shared.ts`, `lib/agent/tools.ts`

- 12 tool schemas covering search, planning, batch execution, CRUD, identification, and rescheduling
- Dynamic system prompt with state injection (conversation history, booking/cancel job status, event cache, pending reschedule)
- Shared behavioral rules in `prompt-shared.ts` used by both text and voice prompts

### Layer 5 — Google Calendar Tools
**Files:** `lib/calendar/*`

- `findFreeSlots` — Freebusy query with gap-walking algorithm
- `isSlotFree` / `eventsOverlappingRange` — Targeted slot availability checks
- `listEventsPaginated` — Full calendar listing across pages
- `createEvent` / `deleteEvent` / `patchEvent` — Event CRUD
- `lookupEvent` / `getEventById` — Event retrieval
- `getTimeWindowBounds` — Working-hours-aware window computation with empty-range fallback

## API Routes

### Auth Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/login` | GET | Redirect to Google OAuth consent screen |
| `/api/auth/callback` | GET | Exchange code, store tokens, set cookie, redirect |
| `/api/auth/logout` | POST | Delete Redis tokens, clear cookie |
| `/api/auth/status` | GET | Return `{ authenticated, email? }` |

### Core Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chat` | POST | Text chat orchestrator (agentic loop, 12 tools) |
| `/api/realtime/session` | POST | Mint ephemeral WebRTC token |
| `/api/realtime/tools` | POST | Voice tool execution |
| `/api/booking/run` | POST | SSE-streamed batch booking execution |
| `/api/booking/progress` | GET | Booking job progress snapshot |
| `/api/cancel/run` | POST | SSE-streamed batch cancel execution |
| `/api/cancel/progress` | GET | Cancel job progress snapshot |
