# Smart Scheduler AI Agent

> A voice-enabled AI scheduling assistant that uses WebRTC, OpenAI Realtime API, and Google Calendar to find and book meeting times through natural conversation — with per-user OAuth, conflict resolution, and automatic multi-booking.

---

## Overview

The Smart Scheduler Agent is a voice-and-text AI assistant that handles end-to-end meeting scheduling. It handles:

- **Multi-turn conversation with memory** — carries context across deviations; never asks for info the user already provided
- **Natural language understanding** — "ASAP", "tomorrow morning", "half an hour", "next Friday afternoon"
- **Google Calendar integration** — freebusy queries, event CRUD, attendee management
- **Advanced conflict resolution** — shows blocking events, suggests alternatives across days/windows automatically
- **Automatic cancel & reschedule** — executes in one turn with zero confirmations for unambiguous requests
- **Multi-booking batch** — books multiple meetings in a single confirmation step
- **Per-user Google OAuth** — users sign in with their own Google account; no shared refresh token needed
- **Working hours from UI** — user-configurable start/end hours, respected in all slot searches
- **Voice interface** — WebRTC direct connection to OpenAI Realtime API (<800ms voice-to-voice latency)
- **Interactive slot picker** — clickable cards for booking available time slots
- **Timezone-aware** — all date/time computation uses the user's local timezone

---

## Architecture

The system has two parallel communication pipelines sharing the same backend, protected by per-user auth:

```
┌─────────────────────────────────────────────────────────────┐
│                       User Browser                           │
│                                                              │
│  Google OAuth Login ──► /api/auth/login → callback → cookie  │
│                                                              │
│  Text Chat ──────────► POST /api/chat                        │
│                        (LLM agentic loop, up to 8 tools)     │
│                                                              │
│  Voice (WebRTC) ─────► OpenAI Realtime API                   │
│    Tool calls ───────► POST /api/realtime/tools              │
│                                                              │
│  Settings ───────────► Working hours (localStorage)          │
└─────────────────────────────────────────────────────────────┘
         │                      │                    │
         ▼                      ▼                    ▼
┌────────────────┐   ┌──────────────────┐   ┌──────────────┐
│ Google Calendar│   │ Upstash Redis    │   │ Edge         │
│ API v3         │   │ (sessions +      │   │ Middleware    │
│ (per-user auth)│   │  OAuth tokens)   │   │ (HMAC cookie)│
└────────────────┘   └──────────────────┘   └──────────────┘
```

**Text pipeline:** Slot extraction → auto-search → gpt-4o-mini agentic loop (up to 8 tool iterations)

**Voice pipeline:** WebRTC ↔ gpt-realtime-mini. Tool calls routed to `/api/realtime/tools`, results sent back via DataChannel.

**Auth pipeline:** Google OAuth consent → token exchange → HMAC-signed cookie → per-request AsyncLocalStorage auth threading

See `ARCHITECTURE.md` for the full architecture diagram and latency profile.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Text LLM | OpenAI gpt-4o-mini |
| Voice | OpenAI Realtime API via WebRTC (gpt-realtime-mini) |
| Calendar | Google Calendar API v3 |
| Auth | Per-user Google OAuth2 with HMAC-signed session cookies |
| Session & Token Store | Upstash Redis (serverless-compatible) |
| Date math | date-fns + date-fns-tz (timezone-aware) |
| Middleware | Next.js Edge Runtime (Web Crypto API) |
| Deployment | Vercel |

---

## Project Structure

```
app/
  api/
    auth/
      login/route.ts             # Google OAuth redirect
      callback/route.ts          # Token exchange + cookie set
      logout/route.ts            # Clear tokens + cookie
      status/route.ts            # Auth status check
    chat/route.ts                # Text chat orchestrator
    realtime/
      session/route.ts           # Ephemeral WebRTC token
      tools/route.ts             # Voice tool execution
  page.tsx                       # Main UI (chat, voice, settings)
  globals.css                    # Styles

lib/
  agent/                         # Conversation logic
    state.ts, prompt.ts, tools.ts, slot-filler.ts, conflict-resolver.ts
  auth/                          # Per-user authentication
    cookie.ts, tokens.ts, resolve.ts
  calendar/                      # Google Calendar operations
    auth.ts, freebusy.ts, events.ts, utils.ts
  session/store.ts               # Redis session CRUD
  debug.ts                       # Structured debug logger

middleware.ts                    # Edge auth middleware (HMAC cookie verification)

components/
  ChatWindow.tsx                 # Message container
  MessageBubble.tsx              # Message bubble + slot/event cards
```

See `PROJECT_STRUCTURE.md` for the complete file tree.

---

## Setup & Installation

### Prerequisites

- Node.js >= 18
- Google Cloud project with Calendar API enabled
- OpenAI API key
- Upstash Redis instance (free tier works)

### Install

```bash
git clone <repo-url>
cd agenticMeetScheduler
npm install
```

### Configure

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

```env
# Required
OPENAI_API_KEY=sk-...
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Per-user OAuth (production)
NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=any-random-string-for-hmac-signing

# Optional (fallback for dev without OAuth flow)
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=primary
```

### Google Calendar Setup

1. Enable Google Calendar API in Google Cloud Console
2. Create OAuth2 credentials (Web Application type)
3. Add authorized redirect URI: `http://localhost:3000/api/auth/callback`
4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env.local`

**For production:** Set `NEXT_PUBLIC_APP_URL` to your deployed URL and add that URL + `/api/auth/callback` as an authorized redirect URI in Google Cloud Console.

**For local dev without OAuth flow:** You can still use a static refresh token in `GOOGLE_REFRESH_TOKEN` — the system falls back to env-based auth when no user session exists.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- Users are redirected to Google sign-in on first visit (when `SESSION_SECRET` is set)
- **Text mode:** Type in the chat box
- **Voice mode:** Click the microphone button and speak
- **Settings:** Click the gear icon to configure working hours

See `SETUP.md` for detailed step-by-step instructions.

---

## Features

### Booking Flow
1. User states what they need ("30 min meeting tomorrow morning")
2. Agent extracts slots via rule-based NLU, searches calendar
3. Available times shown as clickable cards
4. User clicks a slot or confirms verbally
5. Agent books the meeting

### Multi-Booking (Batch)
1. User says "book 3 one-hour meetings this week"
2. Agent finds slots for ALL meetings first
3. Presents all proposed slots in a single numbered list
4. One confirmation covers all — all `create_event` calls fire together

### Conflict Resolution
When a requested time is fully booked:
1. Agent shows the **blocking events** ("Tuesday 2-4 PM is blocked by Team Standup and Design Review")
2. Agent offers **alternative slots** found via parallel fallback strategies
3. If no alternatives found, suggests concrete next steps ("Want me to check mornings instead?")

### Cancel Flow (Automatic)
1. User says "cancel my 3pm meeting"
2. Agent identifies the event via `lookup_event`
3. If exactly one match: deletes immediately, reports done — **no confirmation asked**
4. If multiple matches: lists them, user picks, then deletes immediately

### Reschedule Flow (Automatic)
1. User says "move my standup to 3pm tomorrow"
2. Agent finds the event, deletes it, finds a new slot, books it — **all in one turn**
3. Zero confirmation prompts throughout

### ASAP Booking (Voice)
- "Book a 30 minute meeting ASAP"
- Uses `find_next_slot` which queries 3 days in parallel
- Returns the soonest available slot

### Calendar Check
- "What's on my calendar tomorrow?"
- Always calls `list_events` fresh (never recites from memory)
- Events displayed as read-only cards

### Working Hours
- Configurable via settings panel (gear icon)
- Persisted to localStorage, sent with every API request
- Agent respects these hours for all slot searches and suggestions

### Per-User Authentication
- Google OAuth consent screen on first visit
- Tokens stored in Redis per user (30-day TTL)
- HMAC-signed session cookie (Edge-compatible middleware)
- Each user accesses their own Google Calendar

---

## Design Decisions

### Conversation Context Injection
The system prompt includes a summary of the last 20 conversation messages. The agent reads this before every response, carrying forward details the user mentioned earlier — even across topic deviations.

### Slot-Filling Over Free-Form LLM
The orchestration layer maintains an explicit `ConversationState` with typed slots. The LLM receives current state on every call and knows exactly what's missing. This makes the conversation predictable and testable.

### Two Separate Pipelines
Text and voice have different latency profiles and tool sets. Text goes through a full agentic loop (gpt-4o-mini). Voice uses the Realtime API with direct tool execution — no agentic loop needed since the model handles multi-step reasoning natively.

### Parallel Conflict Resolution
All fallback strategies run concurrently via `Promise.all`. This means a fully-booked day costs ~1 Calendar API round-trip instead of 3 sequential ones.

### AsyncLocalStorage for Per-User Auth
Per-user OAuth tokens are threaded through all calendar operations via Node.js `AsyncLocalStorage`, avoiding changes to every function signature in the call chain.

### Timezone-Aware Date Computation
All date formatting uses `formatInTimeZone` from `date-fns-tz` with the user's browser timezone. This prevents the UTC-vs-local date mismatch that would occur with `format()` or `toISOString()`.

---

## Latency Optimizations

1. **WebRTC Realtime API** — No separate STT/TTS pipeline
2. **Server VAD** — 800ms silence threshold (reduced from 1500ms)
3. **Parallel Calendar queries** — `find_next_slot` queries 3 days concurrently
4. **Parallel conflict resolution** — All strategies + sub-queries concurrent
5. **Auto-search** — Pre-runs `find_free_slots` when all slots filled (saves 1 LLM round-trip)
6. **Rule-based slot extraction** — Regex-based, <1ms
7. **Performance instrumentation** — `[PERF]` timers across all operations

---

## Testing

```bash
npm test                    # Unit tests
npm run test:integration    # Calendar integration tests (requires credentials)
```

---

## Deployment

```bash
vercel --prod
```

Required environment variables in Vercel dashboard:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API access |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `UPSTASH_REDIS_REST_URL` | Redis session/token store |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth |
| `NEXT_PUBLIC_APP_URL` | Your deployed URL (for OAuth redirect) |
| `SESSION_SECRET` | HMAC signing key for session cookies |

Add your deployed URL + `/api/auth/callback` as an authorized redirect URI in Google Cloud Console.

The WebRTC connection goes directly from the browser to OpenAI — no server relay needed for audio.

---

## Known Limitations

- Single calendar per user — books on the authenticated user's primary calendar
- No recurrence support — single-instance events only
- English only for voice mode

---

## License

MIT
