# Project Structure Overview

## Complete File Tree

```
agenticMeetScheduler/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/
│   │   │   │   └── route.ts          # Google OAuth redirect (generates consent URL)
│   │   │   ├── callback/
│   │   │   │   └── route.ts          # Token exchange, email fetch, Redis store, cookie set
│   │   │   ├── logout/
│   │   │   │   └── route.ts          # Clear Redis tokens + session cookie
│   │   │   └── status/
│   │   │       └── route.ts          # Auth status check (authenticated flag + email)
│   │   ├── chat/
│   │   │   └── route.ts              # Text chat orchestrator (LLM agentic loop, up to 8 iters)
│   │   └── realtime/
│   │       ├── session/
│   │       │   └── route.ts          # Mints ephemeral WebRTC token via OpenAI
│   │       └── tools/
│   │           └── route.ts          # Executes voice tool calls
│   ├── page.tsx                      # Main UI — text chat, WebRTC voice, settings, auth display
│   ├── layout.tsx                    # Root layout
│   └── globals.css                   # Global styles (slot cards, event cards, voice UI, settings)
│
├── lib/
│   ├── agent/
│   │   ├── state.ts                  # ConversationState management & reducers
│   │   ├── prompt.ts                 # System prompt builder with conversation context injection
│   │   ├── tools.ts                  # LLM tool schemas (text pipeline)
│   │   ├── slot-filler.ts            # Rule-based slot extraction from messages
│   │   ├── conflict-resolver.ts      # Parallel fallback slot search (3 strategies, working-hours-aware)
│   │   └── time-parser.ts            # Time parsing utilities
│   ├── auth/
│   │   ├── cookie.ts                 # HMAC-signed session cookie management (Node crypto)
│   │   ├── tokens.ts                 # Per-user OAuth token storage in Redis (30-day TTL)
│   │   └── resolve.ts               # Resolves current user's OAuth2Client from cookie
│   ├── calendar/
│   │   ├── auth.ts                   # Google OAuth2 client creation + AsyncLocalStorage threading
│   │   ├── freebusy.ts               # Find available time slots (gap-walking algorithm)
│   │   ├── events.ts                 # createEvent, listEvents, deleteEvent, lookupEvent
│   │   └── utils.ts                  # Time window bounds (working-hours-aware), slot formatting
│   ├── session/
│   │   └── store.ts                  # Upstash Redis session CRUD
│   ├── debug.ts                      # Structured debug logger (DebugLogger)
│   ├── voice-script.ts               # Rule-based voice summary fallback
│   └── realtime/
│       └── session-config.ts         # Realtime session config reference
│
├── middleware.ts                      # Edge auth middleware (HMAC cookie verification, Web Crypto API)
│
├── components/
│   ├── ChatWindow.tsx                # Message container with auto-scroll
│   ├── MessageBubble.tsx             # Message bubble with slot cards + event cards
│   └── VoiceButton.tsx               # Voice toggle button
│
├── types/
│   └── index.ts                      # TypeScript type definitions (ConversationState, WorkingHours)
│
├── scripts/
│   ├── auth-google.js                # OAuth token generator (dev utility)
│   ├── diagnose-calendar.js          # Calendar diagnostics
│   └── test-api.js                   # API test script
│
├── __tests__/
│   └── agent/
│       ├── state.test.ts             # State management tests
│       └── slot-filler.test.ts       # Slot extraction tests
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
**Files:** `middleware.ts`, `lib/auth/cookie.ts`, `lib/auth/tokens.ts`, `lib/auth/resolve.ts`, `app/api/auth/*`

Per-user Google OAuth flow:
- OAuth scopes: `calendar.events` + `calendar.readonly` + `userinfo.email` (sensitive, not restricted — no Google verification needed)
- Edge middleware validates HMAC-signed session cookies using Web Crypto API
- OAuth callback exchanges code for tokens, stores in Redis, sets cookie
- `resolveCalendarAuth()` reads cookie → Redis tokens → creates OAuth2Client
- `withCalendarAuth()` threads the client via `AsyncLocalStorage` to all calendar operations
- Fallback: when `SESSION_SECRET` is not set, all requests pass through (dev mode)
- Published app: any Google user can sign in (unverified warning screen with bypass)

### Layer 1 — Voice I/O (WebRTC)
**Files:** `app/api/realtime/session/route.ts`, `app/page.tsx` (voice section)

Direct browser-to-OpenAI WebRTC connection via the Realtime API:
- Ephemeral token minted server-side, WebRTC connection client-side
- DataChannel carries session config, tool calls, and transcript events
- Model: `gpt-realtime-mini` with Server VAD (800ms silence, 0.6 threshold)
- Audio plays via remote track on an `<audio>` element
- Voice prompt includes timezone-aware dates and working hours

### Layer 2 — Orchestration Backend
**Files:** `app/api/chat/route.ts`, `app/api/realtime/tools/route.ts`, `lib/agent/*`, `lib/session/store.ts`

Two parallel pipelines sharing the same backend libraries:
- **Text pipeline** (`/api/chat`): slot extraction → auto-search → LLM agentic loop (up to 8 iterations)
- **Voice pipeline** (`/api/realtime/tools`): direct tool execution, result sent back via DataChannel
- Both pipelines wrapped in `runWithAuth` for per-user calendar access

### Layer 3 — LLM Brain
**Files:** `lib/agent/prompt.ts`, `lib/agent/tools.ts`, `app/page.tsx` (buildSessionConfig)

Two separate prompt configurations:
- **Text:** Dynamic system prompt built from ConversationState with conversation history injection, working hours, conflict handling rules, and behavioral instructions for multi-booking/cancel/reschedule
- **Voice:** Inline prompt in `buildSessionConfig()` with 6 tool schemas (adds `find_next_slot`), timezone-aware dates, working hours, same behavioral rules

### Layer 4 — Google Calendar Tools
**Files:** `lib/calendar/*`

Calendar API operations (all use per-user auth via AsyncLocalStorage):
- `findFreeSlots` — Freebusy query with gap-walking algorithm
- `createEvent` — Insert calendar event with attendees
- `listEvents` — List events in a date range
- `lookupEvent` — Search events by name
- `deleteEvent` — Delete event by ID (for reschedule/cancel)
- `getTimeWindowBounds` — Convert "morning"/"afternoon" to UTC ISO bounds with now-clamping, respects user working hours

## API Routes

### Auth Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/login` | GET | Redirect to Google OAuth consent screen |
| `/api/auth/callback` | GET | Exchange code, store tokens, set cookie, redirect to app |
| `/api/auth/logout` | POST | Delete Redis tokens, clear cookie |
| `/api/auth/status` | GET | Return `{ authenticated, email? }` |

### Core Routes

### `POST /api/chat` (Text Chat)
- Receives: `{ message, sessionId, timezone, workingHours }`
- Returns: `{ message, voiceScript, sessionId, slots?, events?, state, debug }`
- Manages full conversation lifecycle with agentic tool loop (up to 8 iterations)

### `POST /api/realtime/session` (Voice Token)
- Returns: `{ token, expires_at, sessionId }`
- Mints ephemeral client secret via OpenAI `/v1/realtime/client_secrets`

### `POST /api/realtime/tools` (Voice Tool Execution)
- Receives: `{ toolName, args, sessionId, timezone, workingHours }`
- Returns: `{ result, sessionId }`
- Executes calendar tools and returns structured results for the voice model

## Frontend Components

### `app/page.tsx`
Main application component:
- Text chat with `/api/chat` integration
- WebRTC voice with DataChannel event handling
- Settings panel (working hours configuration, localStorage persistence)
- Auth display (user email, logout button)
- Slot picker (clickable cards → sends confirmation)
- User transcript ordering (placeholder pattern)
- Pending slots/events merge (prevents duplicate display)

### `components/MessageBubble.tsx`
Renders messages with three modes:
- Plain text (user/assistant messages)
- Slot cards (clickable, numbered, with "Book" hover hint)
- Event cards (read-only, event name + time)

### `components/ChatWindow.tsx`
Container with auto-scroll and loading indicator.

## Data Flow

```
Text Input                          Voice Input
    │                                   │
    ▼                                   ▼
Edge Middleware                    DataChannel events
(HMAC cookie verification)             │
    │                                   │ speech_started → placeholder
    ▼                                   │ transcription.completed → fill
POST /api/chat                         │
    │                                   │ function_call_arguments.done
    ├── Resolve user auth (cookie→Redis)│       │
    ├── Load session (Redis)            │       ▼
    ├── Extract slots (regex)           │  POST /api/realtime/tools
    ├── Auto-search (if ready)          │       │
    ├── Build prompt (with context,     │       ├── Resolve user auth
    │   working hours, conflict rules)  │       ├── Execute tool
    ├── LLM + tool loop (up to 8)      │       ├── Save session
    │   ├── find_free_slots             │       └── Return result → DC
    │   │   └── (on 0 results:          │
    │   │       fetch blocking events + │
    │   │       parallel conflict       │
    │   │       resolution)             │
    │   ├── create_event                │
    │   ├── list_events                 │ response.audio_transcript.done
    │   ├── lookup_event                │       │
    │   └── delete_event                │       ▼
    │                                   │  Merge pendingSlots/Events
    ├── Save session (Redis)            │  into final message
    └── Return response                 │
         │                              ▼
         ▼                         Display in chat
    Display in chat                (text + slot/event cards)
    (text + slot/event cards)
```

## Performance Instrumentation

All operations are instrumented with `[PERF]` prefixed `console.log` timers using `Date.now()` start/end pattern. See `ARCHITECTURE.md` for the full list of instrumented operations.
