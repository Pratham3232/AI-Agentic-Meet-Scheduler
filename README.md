# 🗓️ Smart Scheduler AI Agent

> An AI-powered voice-enabled scheduling assistant that understands natural language, manages multi-turn conversations, and interacts with Google Calendar to find and book meeting slots.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Google Calendar API Setup](#google-calendar-api-setup)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Deploying to Vercel](#deploying-to-vercel)
- [Design Decisions](#design-decisions)
- [Agent Conversation Flow](#agent-conversation-flow)
- [Prompt Engineering](#prompt-engineering)
- [Handling Complex Scenarios](#handling-complex-scenarios)
- [Latency Strategy](#latency-strategy)
- [Known Limitations](#known-limitations)

---

## Overview

The Smart Scheduler Agent is a voice-enabled chatbot that guides a user through booking a meeting. It handles:

- **Multi-turn conversation** with slot-filling (duration → day → time window → confirmation)
- **Natural language time parsing** — "late next week", "before my 6pm flight", "last weekday of this month"
- **Google Calendar integration** — real freebusy queries and event creation
- **Conflict resolution** — suggests alternatives when the requested slot is unavailable
- **Voice interface** — STT → LLM → TTS with sub-800ms perceived latency

---

## Architecture

The system is organized into four layers:

```
┌─────────────────────────────────────────────────────┐
│              Layer 1 — Voice I/O                    │
│   User speaks → STT → text | text → TTS → audio    │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│           Layer 2 — Orchestration Backend           │
│  Conversation state · Intent router · NL parser     │
│  Conflict resolver · Session store                  │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│              Layer 3 — LLM Brain                    │
│   System prompt · Tool schemas · Structured output  │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│          Layer 4 — Google Calendar Tools            │
│    OAuth2 · Freebusy queries · Event creation       │
└─────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**Layer 1 — Voice I/O**
Handles the audio interface. Speech-to-text converts user audio to text before it hits the orchestration layer. After the LLM produces a response, text-to-speech converts it back to audio. Streaming is used at both ends to minimize perceived latency.

**Layer 2 — Orchestration**
The core backend, deployed as a serverless function (Vercel / GCP Cloud Run). This layer:
- Maintains a `ConversationState` object across turns (slots collected, calendar results, current awaiting state)
- Routes each user message to the right action — ask a clarifying question, run a calendar search, or confirm a booking
- Runs NL time parsing to convert ambiguous expressions into ISO date ranges
- Implements the fallback/conflict resolution chain when no slots are found

**Layer 3 — LLM Brain**
An LLM (OpenAI GPT-4o / Anthropic Claude / Gemini) that drives the conversation. It receives the full conversation history + current state on every call, and returns either a natural language question to the user or a structured tool call to invoke.

**Layer 4 — Google Calendar Tools**
Three wrapped Google Calendar API calls exposed as LLM tools:
- `find_free_slots` — queries the freebusy API for a given time range
- `create_event` — inserts an event once the user confirms
- `lookup_event` — finds an existing event by name (used for relative date references like "the day after my kickoff meeting")

---

## Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | API routes + frontend in one deploy |
| LLM | OpenAI GPT-4o or Anthropic Claude 3.5 Sonnet | Strong tool-use and instruction-following |
| Voice (fast path) | OpenAI Realtime API | Single socket for STT + LLM + TTS, lowest latency |
| Voice (composable) | Deepgram STT + ElevenLabs TTS | More control over each leg |
| Calendar | Google Calendar API v3 | Required by assignment |
| Auth | Google OAuth2 / Service Account | Persistent token for backend |
| Session state | Upstash Redis (serverless-compatible) | Survives cold starts, fast reads |
| Date math | `date-fns` + `date-fns-tz` | Reliable timezone-aware arithmetic |
| Deployment | Vercel | Zero-config, edge-friendly |

---

## Project Structure

```
smart-scheduler/
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts          # Main orchestration endpoint
│   │   ├── calendar/
│   │   │   ├── free-slots/
│   │   │   │   └── route.ts      # Freebusy query wrapper
│   │   │   └── create-event/
│   │   │       └── route.ts      # Event creation wrapper
│   │   └── voice/
│   │       └── route.ts          # Realtime API session token
│   ├── page.tsx                  # Chat UI
│   └── layout.tsx
├── lib/
│   ├── agent/
│   │   ├── state.ts              # ConversationState type + reducers
│   │   ├── prompt.ts             # System prompt builder
│   │   ├── tools.ts              # LLM tool schema definitions
│   │   ├── slot-filler.ts        # Slot collection logic
│   │   ├── conflict-resolver.ts  # Fallback chain logic
│   │   └── time-parser.ts        # NL time expression → ISO range
│   ├── calendar/
│   │   ├── auth.ts               # Google OAuth2 client setup
│   │   ├── freebusy.ts           # Find available windows
│   │   ├── events.ts             # Create / lookup events
│   │   └── utils.ts              # Slot formatting helpers
│   └── session/
│       └── store.ts              # Redis session read/write
├── components/
│   ├── ChatWindow.tsx
│   ├── VoiceButton.tsx
│   └── MessageBubble.tsx
├── types/
│   └── index.ts                  # Shared TypeScript types
├── .env.local.example
├── vercel.json
└── README.md
```

---

## Setup & Installation

### Prerequisites

- Node.js >= 18
- A Google Cloud project with Calendar API enabled
- An OpenAI API key (or Anthropic key if using Claude)
- Upstash Redis instance (free tier works fine)

### Install dependencies

```bash
git clone https://github.com/your-username/smart-scheduler.git
cd smart-scheduler
npm install
```

---

## Google Calendar API Setup

This is the step most people get wrong — do it first.

### Option A: Personal OAuth2 (simplest for demo)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** — type: **Web Application**
3. Add `http://localhost:3000` to authorized redirect URIs
4. Download the credentials JSON
5. Enable the **Google Calendar API** in your project
6. Run the one-time auth flow to generate a `refresh_token`:

```bash
npm run auth:google
```

This opens a browser, prompts you to sign in, and writes a `tokens.json` to `.credentials/`. The refresh token is what you store in your env vars — it never expires unless revoked.

### Option B: Service Account (for server-to-server, production-grade)

1. Go to **IAM & Admin** → **Service Accounts** → Create a new service account
2. Download the JSON key file
3. Share your Google Calendar with the service account email (give it "Make changes to events" permission)
4. Set `GOOGLE_SERVICE_ACCOUNT_JSON` in your env to the contents of the key file (base64-encoded)

**Recommendation:** Use Option A for the demo (simpler setup), document that Option B is the production path.

---

## Environment Variables

Copy `.env.local.example` to `.env.local` and fill in all values:

```bash
cp .env.local.example .env.local
```

```env
# LLM
OPENAI_API_KEY=sk-...
# or: ANTHROPIC_API_KEY=sk-ant-...

# Google Calendar (Option A — personal OAuth2)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# Google Calendar (Option B — service account, base64 of the JSON key)
# GOOGLE_SERVICE_ACCOUNT_JSON=

# Calendar ID to read/write (use "primary" for the signed-in user's main calendar)
GOOGLE_CALENDAR_ID=primary

# Session store
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# OpenAI Realtime (for voice)
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview-2024-12-17

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Running Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Text mode:** type in the chat box.
**Voice mode:** click the microphone button and speak. The first click requests microphone permission.

### Running tests

```bash
npm test                    # unit tests (state, time parser, conflict resolver)
npm run test:integration    # Calendar API integration tests (requires real credentials)
```

---

## Deploying to Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

Add all environment variables via the Vercel dashboard under **Settings → Environment Variables** — do not commit `.env.local`.

For the voice WebSocket (OpenAI Realtime API), the `/api/voice` route returns a short-lived session token to the frontend. The WebSocket connection is opened directly from the browser to OpenAI — this keeps the audio path off your server and eliminates a latency leg.

```
Browser ──WebSocket──► OpenAI Realtime API
   │
   └─HTTP──► /api/chat  (for tool results, calendar calls)
```

---

## Design Decisions

### Why slot-filling over free-form LLM orchestration

A purely free-form LLM approach ("just let the model figure out what to ask") is unreliable — the model may ask for information in different orders across turns, forget it collected duration already, or produce inconsistent JSON for tool calls. Instead, the orchestration layer maintains an explicit `slots` object:

```typescript
interface ConversationState {
  slots: {
    duration: number | null;       // minutes
    day: string | null;            // ISO date string
    timeWindow: string | null;     // "morning" | "afternoon" | "evening" | ISO range
    attendees: string[];
  };
  calendarResults: TimeSlot[];
  awaitingConfirmation: boolean;
  lastSearchParams: SearchParams | null;
  turnCount: number;
}
```

The LLM is given this state on every call. It knows exactly which slots are missing and asks for only the next missing one. This makes the conversation predictable and easy to test.

### Why the LLM handles time parsing, not a library

Libraries like Chrono.js handle common cases ("next Tuesday", "3pm") but fail on everything in the advanced test cases — "a day or two after the Project Alpha kickoff", "last weekday of this month", "an hour before my 5pm meeting". These require reasoning, not regex. The approach used here:

1. Pass the raw time expression to the LLM with today's date and the full calendar context
2. Ask it to return a structured `{ start: ISO, end: ISO, confidence: number }` object
3. If `confidence < 0.8`, the orchestrator asks the user to clarify before searching

`date-fns` is used only for arithmetic *after* the LLM resolves the expression — e.g. adding/subtracting durations, finding the last weekday of a month.

### Why Redis for session state

Vercel serverless functions are stateless — no in-memory state survives between requests. Upstash Redis (HTTP-based) works without persistent TCP connections, making it compatible with edge and serverless environments. Session keys are tied to a `sessionId` cookie, TTL is 2 hours.

### Conflict resolution chain

When `find_free_slots` returns empty, the resolver walks this chain without asking the user for each step:

```
1. Same day, expand time window to full day
2. ±1 day from requested day, same time window
3. Next 3 weekdays, any time
4. → Only now ask the user: "I couldn't find a slot on Tuesday.
   Would Wednesday or Thursday work?"
```

Steps 1–3 happen silently in one turn. The user only sees a message if all three expansions fail.

---

## Agent Conversation Flow

```
User message
     │
     ▼
Reconstruct ConversationState from session
     │
     ▼
NL time parser (if time expression detected)
     │
     ▼
LLM call with: system prompt + conversation history + current state + tool schemas
     │
     ├── LLM returns text question  ──► Stream to user, update state
     │
     └── LLM returns tool call
              │
              ├── find_free_slots ──► Calendar freebusy API
              │        │
              │        ├── slots found ──► LLM presents options to user
              │        └── no slots   ──► Conflict resolver ──► LLM presents alternatives
              │
              ├── create_event ──────► Calendar insert API ──► Confirm to user
              │
              └── lookup_event ──────► Calendar search API ──► Feed date back to LLM
```

---

## Prompt Engineering

The system prompt is built dynamically on each turn from the current `ConversationState`. Key sections:

### Role and constraints

```
You are a scheduling assistant. Your only job is to help the user find
a meeting time and book it on their Google Calendar.

Rules:
- Ask for one missing piece of information at a time. Never ask two questions in one message.
- Never invent available time slots. Only present slots returned by the find_free_slots tool.
- If the user changes a requirement mid-conversation (e.g. "make it 1 hour instead"),
  re-run find_free_slots with the updated parameter before presenting options.
- Keep responses short and conversational. No bullet points unless presenting slot options.
```

### State injection

```
Current conversation state:
- Duration collected: {{slots.duration ?? "not yet"}}
- Day collected: {{slots.day ?? "not yet"}}
- Time window collected: {{slots.timeWindow ?? "not yet"}}
- Slots found on last search: {{calendarResults.length}} options
- Awaiting user confirmation: {{awaitingConfirmation}}

Today's date: {{today ISO}}
User's timezone: {{timezone}}
```

### Slot ordering guidance

```
Collect information in this order if not already provided:
1. Duration (how long is the meeting?)
2. Day preference (any specific day or range?)
3. Time-of-day preference (morning / afternoon / evening?)
Only call find_free_slots once you have all three.
```

---

## Handling Complex Scenarios

### "Before my 6pm flight on Friday"

1. NL parser detects "before [event] on [day]" pattern
2. `lookup_event` is called to find if there's a flight event on Friday (optional — parser may use the stated time directly)
3. Parser resolves to `{ end: "Friday 17:00", buffer: 60 }` (leaving 1hr before the flight)
4. `find_free_slots` called with `timeMax = Friday 17:00 minus duration minus 60min buffer`

### "A day after the Project Alpha kickoff"

1. LLM detects it needs to resolve "Project Alpha kickoff" before it can compute the date
2. Calls `lookup_event("Project Alpha kickoff")` → returns event date
3. Parser adds 1 day to that date
4. `find_free_slots` called for that resolved date

### "Usual sync-up"

1. LLM detects "usual" implies a recurring context it doesn't have
2. Calls `lookup_event("sync")` to find recurring events in the calendar
3. If found, infers duration from the recurring event's duration field
4. If not found, asks the user: "How long is your usual sync-up?"

### Changing duration mid-search

```
User: "Find a 30-minute slot tomorrow morning."
Agent: [calls find_free_slots(duration=30, day=tomorrow, window=morning)]
       "I have 9:30 AM or 11:00 AM available."
User: "Actually we need a full hour."
```

The state update: `slots.duration = 60`, `calendarResults = []`, `awaitingConfirmation = false`. The orchestrator detects duration changed and `lastSearchParams` is now stale — it automatically re-calls `find_free_slots` before presenting new options. The user sees: "Got it — let me re-check for 1-hour slots tomorrow morning... I have 9:00 AM available."

---

## Latency Strategy

Target: **< 800ms from end of user speech to first audio byte of agent response.**

| Leg | Typical latency | Optimization |
|---|---|---|
| STT (Deepgram streaming) | 200–300ms | Use streaming mode — partial transcripts as user speaks |
| LLM first token | 300–500ms | Stream response, send TTS the first sentence immediately |
| TTS first audio | 100–200ms | Sentence-level streaming — don't wait for full response |
| Calendar API | 100–400ms | Only called when agent decides to act, not on every turn |

With OpenAI Realtime API, legs 1–3 collapse into a single WebSocket with built-in streaming, typically achieving 300–500ms end-to-end.

Calendar API calls add latency only on tool-use turns (not on every conversational turn). For the freebusy query, results are cached in the session store for 30 seconds to avoid redundant API calls if the user says "what about Thursday?" right after checking Tuesday.

---

## Known Limitations

- **Single calendar only** — the agent books on the authenticated user's primary calendar. Multi-attendee conflict checking requires all attendees to share calendar access.
- **No recurrence support** — the agent only creates single-instance events. Recurring meetings are out of scope.
- **Timezone handling** — the agent uses the timezone detected from the user's browser. Cross-timezone scheduling ("find a time that works for me in Delhi and my colleague in London") is not supported.
- **"Usual sync-up" memory** — inferring meeting duration from past calendar events works only if the event name closely matches the user's phrasing. Fuzzy matching is basic.

---

## Video Demo

[Link to demo video — to be added before submission]

The demo covers:
1. Basic scheduling flow (duration → day → time → confirm)
2. Conflict resolution (fully booked day → alternative suggestion)
3. Complex time expression ("last weekday of this month")
4. Mid-conversation requirement change (30min → 1hr)

---

## License

MIT# AI-Agentic-Meet-Scheduler
