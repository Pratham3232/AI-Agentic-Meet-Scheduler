# Implementation Summary

## Complete Feature Set

### 1. Multi-Turn Conversation
- **Slot-filling pattern** in `lib/agent/slot-filler.ts` — collects duration, day, time window, attendees
- State management via `lib/agent/state.ts`
- Session persistence with Upstash Redis (2-hour TTL)
- Stale search detection — auto-invalidates results when user changes requirements

### 2. Natural Language Understanding
- Rule-based extraction for common patterns: "tomorrow morning", "half an hour", "ASAP"
- Word-to-number conversion: "one hour" → 60, "thirty minutes" → 30
- Weekday resolution: "next Monday", "this Friday" → ISO date
- Month/date parsing: "May 18", "18th May" → ISO date
- ASAP family: "right now", "urgent", "soonest" → today + anytime

### 3. Google Calendar Integration
- **Freebusy queries** in `lib/calendar/freebusy.ts` — gap-walking algorithm with 30-min boundaries
- **Event creation** in `lib/calendar/events.ts` — with attendees and description
- **Event listing** — date range queries with formatted display
- **Event lookup** — search by name for reschedule/cancel flows
- **Event deletion** — remove events by ID
- OAuth2 and Service Account authentication support

### 4. Conflict Resolution
- 3-strategy parallel fallback in `lib/agent/conflict-resolver.ts`:
  1. Expand time window to full business day (8AM–6PM)
  2. Try adjacent days (±1), both queried in parallel
  3. Try next 3 weekdays, all queried in parallel
- All strategies run via `Promise.all` for minimum latency

### 5. Voice Interface (WebRTC)
- OpenAI Realtime API via WebRTC (not WebSocket)
- Model: `gpt-realtime-mini` with Whisper-1 transcription
- Server VAD: 800ms silence, 0.6 threshold, 200ms prefix padding
- Voice: "coral"
- Ephemeral token minting via `/api/realtime/session`
- DataChannel for session config, tool calls, and transcript events

### 6. Reschedule & Cancel Support
- **Reschedule flow:** lookup_event → confirm → delete_event → find new slot → create_event
- **Cancel flow:** lookup_event → confirm → delete_event
- `delete_event` tool available in both voice and text pipelines
- Both prompts include explicit instructions for reschedule/cancel intents

### 7. Interactive Slot Picker UI
- Available slots rendered as clickable cards with numbered circles
- Hover effect shows "Book" hint
- Clicking a card sends a booking confirmation message
- Works in both text and voice mode (voice sends via DataChannel)

### 8. Event Card Display
- Calendar events displayed as read-only cards (same visual style as slot picker)
- Shows event name + formatted time
- Always fetched fresh via `list_events` (never recited from memory)

### 9. LLM Tool Integration
- **Text pipeline:** 5 tools — `find_free_slots`, `create_event`, `list_events`, `lookup_event`, `delete_event`
- **Voice pipeline:** 6 tools — adds `find_next_slot` for ASAP booking
- Dynamic system prompt with state injection (text pipeline)
- Inline prompt with intent recognition sections (voice pipeline)
- Auto-search optimization saves 1 LLM round-trip when all slots are filled

### 10. Performance Instrumentation
- `[PERF]` prefixed `console.log` timers across all server-side and client-side operations
- Covers: Redis, Calendar API, LLM calls, slot extraction, conflict resolution, voice connection, tool round-trips
- See `ARCHITECTURE.md` for full instrumentation map

### 11. Modern Chat UI
- Gradient design with smooth animations
- Message bubbles with user/assistant styling
- Slot picker cards (interactive) and event cards (read-only)
- Voice mode indicator (speaking/listening status)
- Loading dots animation
- Responsive layout

## Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...

# Google Calendar (OAuth2)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Optional
GOOGLE_CALENDAR_ID=primary
```

## Quick Start

```bash
npm install
cp .env.local.example .env.local
# Fill in API keys
npm run auth:google   # Generate Google refresh token
npm run dev           # Start at http://localhost:3000
```

## Latency Optimizations

1. WebRTC Realtime API — eliminates separate STT/TTS pipeline
2. Server VAD reduced to 800ms silence (from 1500ms)
3. Parallel Calendar queries — `find_next_slot` queries 3 days concurrently
4. Parallel conflict resolution — all 3 strategies + sub-queries concurrent
5. Auto-search — pre-runs `find_free_slots` when slots are filled (saves 1 LLM round-trip)
6. Rule-based slot extraction — <1ms, no LLM call needed
7. Text shown immediately — not blocked by audio

## Testing

```bash
npm test                    # Unit tests (state, slot-filler)
npm run test:integration    # Calendar API integration tests (requires credentials)
```
