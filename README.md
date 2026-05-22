# Smart Scheduler AI Agent

> A voice-enabled AI scheduling assistant that uses WebRTC, OpenAI Realtime API, and Google Calendar to find and book meeting times through natural conversation — with per-user OAuth, advanced conflict resolution, batch booking/cancelling, and smart rescheduling.

---

## Overview

The Smart Scheduler Agent is a voice-and-text AI assistant that handles end-to-end meeting scheduling. It handles:

- **Multi-turn conversation with memory** — carries context across deviations; never asks for info the user already provided
- **Natural language understanding** — "ASAP", "tomorrow morning", "half an hour", "next Friday afternoon", "5 AM every weekday next month"
- **Google Calendar integration** — freebusy queries, event CRUD, paginated listing, attendee management
- **Advanced conflict resolution** — shows blocking events, proximity-ranked alternatives, never dead-ends
- **Batch booking system** — plan and book across multiple days in one flow (e.g., "daily standup at 10 AM for all weekdays in June") with SSE progress UI
- **Batch cancel system** — bulk-cancel events by date range with progress tracking
- **Smart rescheduling** — `identify_event` + `reschedule_event` workflow with time-hint matching and preview mode
- **Automatic cancel & reschedule** — executes in one turn with zero confirmations for unambiguous requests
- **Per-user Google OAuth** — users sign in with their own Google account; no shared refresh token needed
- **Working hours from UI** — user-configurable start/end hours; explicit times bypass working-hour restrictions
- **Voice interface** — WebRTC direct connection to OpenAI Realtime API (<800ms voice-to-voice latency)
- **Interactive slot picker** — clickable cards for booking available time slots
- **Booking/cancel progress UI** — real-time progress bar with per-day status rail
- **Timezone-aware** — all date/time computation uses the user's local timezone
- **Event caching** — server-side calendar snapshot for fast re-queries within a session

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
│  Booking SSE ────────► POST /api/booking/run                 │
│  Cancel SSE ─────────► POST /api/cancel/run                  │
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

**Batch pipelines:** SSE-streamed booking/cancel execution via `/api/booking/run` and `/api/cancel/run` with progress polling endpoints

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
    chat/route.ts                # Text chat orchestrator (agentic loop)
    realtime/
      session/route.ts           # Ephemeral WebRTC token
      tools/route.ts             # Voice tool execution
    booking/
      run/route.ts               # SSE booking job execution
      progress/route.ts          # Booking progress polling
    cancel/
      run/route.ts               # SSE cancel job execution
      progress/route.ts          # Cancel progress polling
  page.tsx                       # Main UI (chat, voice, settings, progress)
  globals.css                    # Styles

lib/
  agent/                         # Conversation + scheduling logic
    prompt.ts, prompt-shared.ts  # System prompt + shared rules
    tools.ts                     # LLM tool schemas (12 tools)
    slot-filler.ts, state.ts     # Slot extraction + state management
    find-slots.ts                # Extracted slot search with proximity ranking
    multi-booking.ts             # Multi-day booking planner
    multi-day-plan.ts            # Plan building utilities
    booking-executor.ts          # Batch booking job execution
    booking-context.ts           # Booking job prompt injection
    cancel-executor.ts           # Batch cancel job execution
    cancel-context.ts            # Cancel job prompt injection
    event-matcher.ts             # Smart event identification + rescheduling
    event-cache.ts               # Server-side calendar snapshot
    conflict-resolver.ts         # Parallel fallback strategies
  auth/                          # Per-user authentication
    cookie.ts, tokens.ts, resolve.ts
  calendar/                      # Google Calendar operations
    auth.ts, freebusy.ts, events.ts, utils.ts, slot-search.ts
  client/                        # Client-side utilities
    booking-progress-ui.ts, cancel-progress-ui.ts, realtime-response-gate.ts
  session/store.ts               # Redis session CRUD

middleware.ts                    # Edge auth middleware

components/
  ChatWindow.tsx, MessageBubble.tsx, VoiceButton.tsx
  BookingProgress.tsx, CancelProgress.tsx, BookingDayRail.tsx
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
2. Configure OAuth consent screen with scopes: `calendar.events`, `calendar.readonly`, `userinfo.email`
3. Create OAuth2 credentials (Web Application type)
4. Add authorized redirect URI: `http://localhost:3000/api/auth/callback`
5. Publish the app to allow any Google user (users see "unverified" warning but can proceed)

See `SETUP.md` for detailed step-by-step instructions.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

### Booking Flow
1. User states what they need ("30 min meeting tomorrow at 10 AM")
2. Agent searches calendar with proximity-ranked results around the requested time
3. If exact time is free, confirms immediately; if blocked, shows blocker + nearest alternatives
4. User clicks a slot or confirms verbally → agent books

### Multi-Day Batch Booking
1. User says "book a daily standup at 10 AM for all weekdays next month"
2. Agent calls `plan_multi_day_bookings` — resolves all days, checks each for conflicts
3. Presents a summary ("22 weekdays in June at 10:00 AM, 2 conflicts")
4. One confirmation → `init_booking_job` + `execute_booking_batch`
5. Client SSE streams remaining bookings with real-time progress bar + day rail

### Conflict Resolution
When a requested time is fully booked:
1. Agent shows the **blocking events** with exact times
2. Agent offers **proximity-ranked alternatives** (nearest times to what was requested)
3. If no alternatives found, suggests concrete next steps

### Bulk Cancel
1. User says "cancel all my meetings this week"
2. Agent lists events, asks for one confirmation with count
3. `init_cancel_job` + `execute_cancel_batch` → SSE streams cancellations with progress bar

### Smart Reschedule
1. User says "move my 4-7 PM meeting to tomorrow"
2. Agent calls `identify_event` with time/title hints to find the exact event
3. Shows preview: "Move Design Review from Thursday 4-7 PM to Friday 4-7 PM?"
4. On confirm → `reschedule_event(confirmed: true)` handles delete + create atomically

### Cancel Flow (Automatic)
- Single match: deletes immediately, no confirmation
- Multiple matches: lists them, user picks, then deletes

### ASAP Booking (Voice)
- "Book a 30 minute meeting ASAP" → queries 3 days in parallel, returns soonest slot

### Calendar Check
- "What's on my calendar tomorrow?" → always calls `list_events` fresh
- Results cached server-side for fast re-queries within the session

### Working Hours
- Configurable via settings panel (gear icon)
- Explicit times ("5 AM", "10 PM") bypass working-hour restrictions
- Vague requests ("morning", "ASAP") search within configured hours

### Per-User Authentication
- Google OAuth consent screen on first visit
- Published app: any Google user can sign in (unverified warning with bypass)
- Tokens stored in Redis per user (30-day TTL)
- HMAC-signed session cookie (Edge-compatible middleware)

---

## Tools (12 total)

| Tool | Purpose |
|------|---------|
| `find_free_slots` | Search for available slots with optional preferred time (proximity-ranked) |
| `plan_multi_day_bookings` | Plan bookings across multiple days at the same time |
| `init_booking_job` | Initialize a batch booking job after user confirms plan |
| `execute_booking_batch` | Execute next batch of pending bookings (SSE continues the rest) |
| `init_cancel_job` | Initialize bulk cancellation job |
| `execute_cancel_batch` | Execute next batch of cancellations (SSE continues the rest) |
| `create_event` | Book a single meeting on the calendar |
| `list_events` | List calendar events for a date range (paginated) |
| `identify_event` | Find events by time hint and/or title (for reschedule) |
| `reschedule_event` | Move an event to a new time (preview or execute) |
| `lookup_event` | Search for an event by name |
| `delete_event` | Delete a single event by ID |

---

## Design Decisions

### Proximity-Ranked Slot Search
When the user names a specific time (e.g., "10 AM"), alternatives are sorted by proximity — nearest times first (9:30, 10:30, 9:00, 11:00) rather than chronologically from morning.

### Batch Job Architecture
Multi-day bookings and bulk cancellations use a job-based pattern: LLM initializes the job, executes the first batch, then the client takes over via SSE to complete the rest. This avoids LLM tool-call limits and provides real-time progress feedback.

### Event Cache
Server-side calendar snapshots (`cachedCalendar` on session state) avoid redundant API calls when the user asks follow-up questions about the same time range.

### Shared Prompt Rules
Behavioral rules (conflict handling, multi-day booking, bulk cancel, reschedule workflow) are defined once in `prompt-shared.ts` and injected into both text and voice prompts.

### Conversation Context Injection
Last 20 conversation messages summarized and injected into system prompt on every request.

### AsyncLocalStorage for Per-User Auth
Per-user OAuth tokens threaded through all calendar operations via Node.js `AsyncLocalStorage`.

### Timezone-Aware Date Computation
All date formatting uses `formatInTimeZone` from `date-fns-tz` with the user's browser timezone.

---

## Latency Optimizations

1. **WebRTC Realtime API** — No separate STT/TTS pipeline
2. **Server VAD** — 800ms silence threshold
3. **Parallel Calendar queries** — `find_next_slot` queries 3 days concurrently
4. **Parallel conflict resolution** — All strategies + sub-queries concurrent
5. **Auto-search** — Pre-runs `find_free_slots` when all slots filled (saves 1 LLM round-trip)
6. **Rule-based slot extraction** — Regex-based, <1ms
7. **Event caching** — Avoids redundant Calendar API calls within a session
8. **SSE batch execution** — Client-driven progress avoids LLM tool-call bottleneck

---

## Testing

```bash
npm test                    # Unit tests (17 test suites)
npm run test:integration    # Calendar API integration tests
```

Test coverage includes: state management, slot filler, booking executor, cancel executor, event matcher, event cache, multi-booking planner, multi-day plan, booking context, booking SSE, slot search, booking progress UI, realtime response gate, and component tests.

---

## Deployment

Deployed on Vercel at: **https://ai-agentic-meet-scheduler.vercel.app**

```bash
vercel login
vercel link
vercel --prod
```

Required environment variables (add via `vercel env add <KEY>` for all environments):

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API access |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `UPSTASH_REDIS_REST_URL` | Redis session/token store |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth |
| `NEXT_PUBLIC_APP_URL` | Your deployed URL (for OAuth redirect) |
| `SESSION_SECRET` | HMAC signing key for session cookies |
| `GOOGLE_CALENDAR_ID` | `primary` (or specific calendar ID) |

Function timeouts are set via `export const maxDuration` in each route file (Next.js App Router pattern). `vercel.json` only sets `{"framework": "nextjs"}`.

---

## Known Limitations

- Single calendar per user — books on the authenticated user's primary calendar
- No recurrence support — single-instance events only (batch booking creates individual events)
- English only for voice mode

---

## License

MIT
