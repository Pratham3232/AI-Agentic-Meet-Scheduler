# Smart Scheduler AI Agent

> A voice-enabled AI scheduling assistant that uses WebRTC, OpenAI Realtime API, and Google Calendar to find and book meeting times through natural conversation.

---

## Overview

The Smart Scheduler Agent is a voice-and-text chatbot that guides users through scheduling meetings. It handles:

- **Multi-turn conversation** with slot-filling (duration, day, time window, attendees)
- **Natural language understanding** — "ASAP", "tomorrow morning", "half an hour", "next Friday afternoon"
- **Google Calendar integration** — real freebusy queries, event creation, listing, lookup, and deletion
- **Conflict resolution** — parallel fallback strategies when the requested slot is unavailable
- **Reschedule & cancel** — find the old event, delete it, find a new slot, book it
- **Voice interface** — WebRTC direct connection to OpenAI Realtime API (no separate STT/TTS pipeline)
- **Interactive slot picker** — clickable cards for booking available time slots
- **Event card display** — read-only cards showing calendar events

---

## Architecture

The system has two parallel communication pipelines sharing the same backend:

```
┌─────────────────────────────────────────────────┐
│                  User Browser                    │
│                                                  │
│  Text Chat ──────► POST /api/chat                │
│                    (LLM agentic loop)            │
│                                                  │
│  Voice (WebRTC) ──► OpenAI Realtime API          │
│    Tool calls ───► POST /api/realtime/tools      │
└─────────────────────────────────────────────────┘
                        │
         ┌──────────────┴──────────────┐
         ▼                             ▼
┌────────────────┐          ┌────────────────────┐
│ Google Calendar│          │ Upstash Redis      │
│ API v3         │          │ (session state)    │
└────────────────┘          └────────────────────┘
```

**Text pipeline:** Slot extraction → auto-search → gpt-4o-mini agentic loop (up to 5 tool iterations)

**Voice pipeline:** WebRTC ↔ gpt-realtime-mini. Tool calls routed to `/api/realtime/tools`, results sent back via DataChannel.

See `ARCHITECTURE.md` for the full architecture diagram and latency profile.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Text LLM | OpenAI gpt-4o-mini |
| Voice | OpenAI Realtime API via WebRTC (gpt-realtime-mini) |
| Calendar | Google Calendar API v3 |
| Auth | Google OAuth2 / Service Account |
| Session | Upstash Redis (serverless-compatible) |
| Date math | date-fns + date-fns-tz |
| Deployment | Vercel |

---

## Project Structure

```
app/
  api/
    chat/route.ts              # Text chat orchestrator
    realtime/
      session/route.ts         # Ephemeral WebRTC token
      tools/route.ts           # Voice tool execution
  page.tsx                     # Main UI
  globals.css                  # Styles

lib/
  agent/                       # Conversation logic
    state.ts, prompt.ts, tools.ts, slot-filler.ts, conflict-resolver.ts
  calendar/                    # Google Calendar operations
    auth.ts, freebusy.ts, events.ts, utils.ts
  session/store.ts             # Redis session CRUD
  debug.ts                     # Structured debug logger

components/
  ChatWindow.tsx               # Message container
  MessageBubble.tsx            # Message bubble + slot/event cards
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
OPENAI_API_KEY=sk-...
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
GOOGLE_CALENDAR_ID=primary
```

### Google Calendar Setup

**Option A: OAuth2 (recommended for development)**

1. Enable Google Calendar API in Google Cloud Console
2. Create OAuth2 credentials (Web Application type)
3. Add `http://localhost:3000` to authorized redirect URIs
4. Run: `npm run auth:google`
5. Copy the refresh token to `.env.local`

**Option B: Service Account (production)**

1. Create a service account in Google Cloud Console
2. Download the JSON key file
3. Share your calendar with the service account email
4. Base64 encode the JSON: `cat service-account.json | base64`
5. Set `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env.local`

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- **Text mode:** Type in the chat box
- **Voice mode:** Click the microphone button and speak

---

## Features

### Booking Flow
1. User states what they need ("30 min meeting tomorrow morning")
2. Agent extracts slots, searches calendar
3. Available times shown as clickable cards
4. User clicks a slot or confirms verbally
5. Agent books the meeting

### Reschedule Flow
1. User says "reschedule my standup"
2. Agent finds the event via `lookup_event`
3. Confirms the change with the user
4. Deletes old event, finds new slot, creates new event

### Cancel Flow
1. User says "cancel my 3pm meeting"
2. Agent identifies the event
3. Confirms, then deletes via `delete_event`

### ASAP Booking (Voice)
- "Book a 30 minute meeting ASAP"
- Uses `find_next_slot` which queries 3 days in parallel
- Returns the soonest available slot

### Calendar Check
- "What's on my calendar tomorrow?"
- Always calls `list_events` fresh (never recites from memory)
- Events displayed as read-only cards

---

## Design Decisions

### Slot-Filling Over Free-Form LLM
The orchestration layer maintains an explicit `ConversationState` with typed slots. The LLM receives current state on every call and knows exactly what's missing. This makes the conversation predictable and testable.

### Two Separate Pipelines
Text and voice have different latency profiles and tool sets. Text goes through a full agentic loop (gpt-4o-mini). Voice uses the Realtime API with direct tool execution — no agentic loop needed since the model handles multi-step reasoning natively.

### Parallel Conflict Resolution
All fallback strategies run concurrently via `Promise.all`. This means a fully-booked day costs ~1 Calendar API round-trip instead of 3 sequential ones.

### Pending Refs Pattern (Voice)
Tool results are stashed in `pendingSlotsRef`/`pendingEventsRef` and merged into the model's spoken transcript when it finalizes. This prevents duplicate display (cards + spoken text both appearing).

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

Add environment variables in the Vercel dashboard under Settings → Environment Variables.

The WebRTC connection goes directly from the browser to OpenAI — no server relay needed for audio.

---

## Known Limitations

- Single calendar only — books on the authenticated user's primary calendar
- No recurrence support — single-instance events only
- Timezone from browser — no cross-timezone scheduling
- English only for voice mode

---

## License

MIT
