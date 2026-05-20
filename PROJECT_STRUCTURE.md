# Project Structure Overview

## Complete File Tree

```
agenticMeetScheduler/
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts              # Text chat orchestrator (LLM agentic loop)
│   │   └── realtime/
│   │       ├── session/
│   │       │   └── route.ts          # Mints ephemeral WebRTC token via OpenAI
│   │       └── tools/
│   │           └── route.ts          # Executes voice tool calls
│   ├── page.tsx                      # Main UI — text chat, WebRTC voice, slot/event cards
│   ├── layout.tsx                    # Root layout
│   └── globals.css                   # Global styles (slot cards, event cards, voice UI)
│
├── lib/
│   ├── agent/
│   │   ├── state.ts                  # ConversationState management & reducers
│   │   ├── prompt.ts                 # System prompt builder (text pipeline)
│   │   ├── tools.ts                  # LLM tool schemas (text pipeline)
│   │   ├── slot-filler.ts            # Rule-based slot extraction from messages
│   │   └── conflict-resolver.ts      # Parallel fallback slot search (3 strategies)
│   ├── calendar/
│   │   ├── auth.ts                   # Google OAuth2 / Service Account setup
│   │   ├── freebusy.ts               # Find available time slots
│   │   ├── events.ts                 # createEvent, listEvents, deleteEvent, lookupEvent
│   │   └── utils.ts                  # Time window bounds, slot formatting, now-clamping
│   ├── session/
│   │   └── store.ts                  # Upstash Redis session CRUD
│   ├── debug.ts                      # Structured debug logger (DebugLogger)
│   ├── voice-script.ts               # Rule-based voice summary fallback
│   └── realtime/
│       └── session-config.ts         # Realtime session config (reference, logic in page.tsx)
│
├── components/
│   ├── ChatWindow.tsx                # Message container with auto-scroll
│   └── MessageBubble.tsx             # Message bubble with slot cards + event cards
│
├── types/
│   └── index.ts                      # TypeScript type definitions
│
├── scripts/
│   └── auth-google.js                # OAuth token generator
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
├── vercel.json                       # Vercel deployment config
├── README.md                         # Full project documentation
├── SETUP.md                          # Setup instructions
├── ARCHITECTURE.md                   # Architecture & latency profile
├── IMPLEMENTATION_SUMMARY.md         # Implementation checklist
└── PROJECT_STRUCTURE.md              # This file
```

## Layer Architecture

### Layer 1 — Voice I/O (WebRTC)
**Files:** `app/api/realtime/session/route.ts`, `app/page.tsx` (voice section)

Direct browser-to-OpenAI WebRTC connection via the Realtime API:
- Ephemeral token minted server-side, WebRTC connection client-side
- DataChannel carries session config, tool calls, and transcript events
- Model: `gpt-realtime-mini` with Server VAD (800ms silence, 0.6 threshold)
- Audio plays via remote track on an `<audio>` element

### Layer 2 — Orchestration Backend
**Files:** `app/api/chat/route.ts`, `app/api/realtime/tools/route.ts`, `lib/agent/*`, `lib/session/store.ts`

Two parallel pipelines sharing the same backend libraries:
- **Text pipeline** (`/api/chat`): slot extraction → auto-search → LLM agentic loop
- **Voice pipeline** (`/api/realtime/tools`): direct tool execution, result sent back via DataChannel

### Layer 3 — LLM Brain
**Files:** `lib/agent/prompt.ts`, `lib/agent/tools.ts`, `app/page.tsx` (buildSessionConfig)

Two separate prompt configurations:
- **Text:** Dynamic system prompt built from ConversationState, 5 tool schemas
- **Voice:** Inline prompt in `buildSessionConfig()` with 6 tool schemas (adds `find_next_slot`)

### Layer 4 — Google Calendar Tools
**Files:** `lib/calendar/*`

Calendar API operations:
- `findFreeSlots` — Freebusy query with gap-walking algorithm
- `createEvent` — Insert calendar event with attendees
- `listEvents` — List events in a date range
- `lookupEvent` — Search events by name
- `deleteEvent` — Delete event by ID (for reschedule/cancel)
- `getTimeWindowBounds` — Convert "morning"/"afternoon" to UTC ISO bounds with now-clamping

## API Routes

### `POST /api/chat` (Text Chat)
- Receives: `{ message, sessionId, timezone }`
- Returns: `{ message, voiceScript, sessionId, slots?, events?, state, debug }`
- Manages full conversation lifecycle with agentic tool loop (up to 5 iterations)

### `POST /api/realtime/session` (Voice Token)
- Returns: `{ token, expires_at, sessionId }`
- Mints ephemeral client secret via OpenAI `/v1/realtime/client_secrets`

### `POST /api/realtime/tools` (Voice Tool Execution)
- Receives: `{ toolName, args, sessionId, timezone }`
- Returns: `{ result, sessionId }`
- Executes calendar tools and returns structured results for the voice model

## Frontend Components

### `app/page.tsx`
Main application component:
- Text chat with `/api/chat` integration
- WebRTC voice with DataChannel event handling
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
POST /api/chat                     DataChannel events
    │                                   │
    ├── Load session (Redis)            │ speech_started → placeholder
    ├── Extract slots (regex)           │ transcription.completed → fill
    ├── Auto-search (if ready)          │
    ├── LLM + tool loop                 │ function_call_arguments.done
    │   ├── find_free_slots             │       │
    │   ├── create_event                │       ▼
    │   ├── list_events                 │  POST /api/realtime/tools
    │   ├── lookup_event                │       │
    │   └── delete_event                │       ├── Execute tool
    │                                   │       ├── Save session
    ├── Save session (Redis)            │       └── Return result → DC
    └── Return response                 │
         │                              │ response.audio_transcript.done
         ▼                              │       │
    Display in chat                     │       ▼
    (text + slot/event cards)           │  Merge pendingSlots/Events
                                        │  into final message
                                        ▼
                                   Display in chat
                                   (text + slot/event cards)
```

## Performance Instrumentation

All operations are instrumented with `[PERF]` prefixed `console.log` timers using `Date.now()` start/end pattern. See `ARCHITECTURE.md` for the full list of instrumented operations.
