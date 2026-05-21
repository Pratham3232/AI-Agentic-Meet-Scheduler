# Implementation Summary

## Complete Feature Set

### 1. Multi-Turn Conversation with Context Memory
- **Slot-filling pattern** in `lib/agent/slot-filler.ts` — collects duration, day, time window, attendees
- **Conversation context injection** — last 20 messages summarized and injected into system prompt via `buildConversationContext()`
- Agent reads full conversation history before every response; carries forward details across topic deviations
- State management via `lib/agent/state.ts`
- Session persistence with Upstash Redis (2-hour TTL)
- Stale search detection — auto-invalidates results when user changes requirements
- History window: 30 turns (increased from 12 to support complex multi-step flows)

### 2. Natural Language Understanding
- Rule-based extraction for common patterns: "tomorrow morning", "half an hour", "ASAP"
- Word-to-number conversion: "one hour" → 60, "thirty minutes" → 30
- Weekday resolution: "next Monday", "this Friday" → ISO date
- Month/date parsing: "May 18", "18th May" → ISO date
- ASAP family: "right now", "urgent", "soonest" → today + anytime
- Duration parsing: "half an hour" → 30, "hour and a half" → 90, "N hours" → N × 60

### 3. Google Calendar Integration
- **Freebusy queries** in `lib/calendar/freebusy.ts` — gap-walking algorithm with 30-min boundaries
- **Event creation** in `lib/calendar/events.ts` — with attendees and description
- **Event listing** — date range queries with formatted display
- **Event lookup** — search by name for reschedule/cancel flows
- **Event deletion** — remove events by ID
- **Per-user OAuth2** authentication with AsyncLocalStorage threading

### 4. Advanced Conflict Resolution
- When no slots found, **blocking events are fetched** and included in the tool result
- 3-strategy parallel fallback in `lib/agent/conflict-resolver.ts`:
  1. Expand time window to full working hours range
  2. Try adjacent days (±1), both queried in parallel
  3. Try next 3 weekdays, all queried in parallel
- All strategies run via `Promise.all` for minimum latency
- All strategies respect user's configured working hours
- LLM follows a 3-step response pattern: show blocker → offer alternatives → suggest next steps
- Agent never dead-ends with "no slots available"

### 5. Voice Interface (WebRTC)
- OpenAI Realtime API via WebRTC (not WebSocket)
- Model: `gpt-realtime-mini` with Whisper-1 transcription
- Server VAD: 800ms silence, 0.6 threshold, 200ms prefix padding
- Voice: "coral"
- Ephemeral token minting via `/api/realtime/session`
- DataChannel for session config, tool calls, and transcript events
- Voice prompt includes timezone-aware dates, working hours, conflict handling rules

### 6. Automatic Cancel & Reschedule
- **Cancel flow:** lookup_event → delete immediately (no confirmation for single match)
- **Reschedule flow:** lookup_event → delete_event → find_free_slots → create_event — all in ONE turn
- Multiple matches: agent lists them, user picks, then executes without further confirmation
- Prompt explicitly instructs: "NEVER say 'Are you sure?' — the user already told you to cancel it"

### 7. Multi-Booking (Batch)
- Agent finds slots for ALL meetings first
- Presents all proposed slots in a single numbered list
- One confirmation covers all bookings
- All `create_event` calls fire together in a single turn
- Never books one meeting then asks "shall I book the next one?"
- MAX_TOOL_LOOPS increased to 8 to support multi-step batch operations
- Gap logic: "1 hour apart" = 1 hour of FREE TIME between end of one and start of next

### 8. Per-User Google OAuth Authentication
- **Login:** `/api/auth/login` → Google OAuth consent screen with `calendar.events`, `calendar.readonly`, and `userinfo.email` scopes (sensitive, not restricted — no Google verification required)
- **Callback:** `/api/auth/callback` → token exchange, email fetch, Redis storage, HMAC cookie
- **Middleware:** Edge-compatible (`middleware.ts`) using Web Crypto API for HMAC verification
- **Token storage:** Upstash Redis at `auth:<userId>` with 30-day TTL
- **Auth threading:** `AsyncLocalStorage<OAuth2Client>` via `withCalendarAuth()` — no function signature changes needed
- **Fallback:** When `SESSION_SECRET` is not set, skips auth (backward-compatible dev mode using `.env.local` refresh token)
- **Logout:** Clears Redis tokens + session cookie
- **Published app:** Any Google user can sign in (unverified app warning with "Advanced → Continue" bypass)

### 8a. Vercel Deployment
- `vercel.json` sets `{"framework": "nextjs"}` only — no functions config
- Function timeouts configured via `export const maxDuration` in each route file (App Router pattern):
  - `/api/chat` — 30s, `/api/realtime/tools` — 15s, `/api/realtime/session` — 10s, `/api/auth/callback` — 10s
- Live deployment: `https://ai-agentic-meet-scheduler.vercel.app`

### 9. User-Configurable Working Hours
- Settings panel in UI (gear icon) with start/end hour dropdowns
- Persisted to `localStorage`, sent with every API request
- Working hours threaded through all calendar utilities and conflict resolver
- `getTimeWindowBounds` uses working hours to generate dynamic time windows
- Default: 9 AM – 5 PM (configurable to any range)

### 10. Timezone-Aware Date Computation
- All date formatting uses `formatInTimeZone()` from `date-fns-tz` with user's browser timezone
- Prevents UTC-vs-local date mismatch (e.g., after local midnight but before UTC midnight)
- Voice config uses `toLocaleDateString('en-CA', { timeZone })` for timezone-correct dates
- System prompt includes timezone-correct today/tomorrow/day-after-tomorrow references

### 11. Interactive Slot Picker UI
- Available slots rendered as clickable cards with numbered circles
- Hover effect shows "Book" hint
- Clicking a card sends a booking confirmation message
- Works in both text and voice mode (voice sends via DataChannel)

### 12. Event Card Display
- Calendar events displayed as read-only cards (same visual style as slot picker)
- Shows event name + formatted time
- Always fetched fresh via `list_events` (never recited from memory)

### 13. LLM Tool Integration
- **Text pipeline:** 5 tools — `find_free_slots`, `create_event`, `list_events`, `lookup_event`, `delete_event`
- **Voice pipeline:** 6 tools — adds `find_next_slot` for ASAP booking
- Dynamic system prompt with state injection (text pipeline)
- Inline prompt with intent recognition sections (voice pipeline)
- Auto-search optimization saves 1 LLM round-trip when all slots are filled

### 14. Performance Instrumentation
- `[PERF]` prefixed `console.log` timers across all server-side and client-side operations
- Covers: Redis, Calendar API, LLM calls, slot extraction, conflict resolution, voice connection, tool round-trips
- See `ARCHITECTURE.md` for full instrumentation map

### 15. Modern Chat UI
- Gradient design with smooth animations
- Message bubbles with user/assistant styling
- Slot picker cards (interactive) and event cards (read-only)
- Voice mode indicator (speaking/listening status)
- Loading dots animation
- Settings panel (gear icon, working hours)
- Auth display (user email, logout button)
- Responsive layout

## Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...

# Google Calendar (OAuth2)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Upstash Redis (sessions + OAuth tokens)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Per-user OAuth (production)
NEXT_PUBLIC_APP_URL=http://localhost:3000
SESSION_SECRET=any-random-string-for-hmac-signing

# Optional (fallback for dev without OAuth flow)
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=primary
```

## Quick Start

```bash
npm install
cp .env.local.example .env.local
# Fill in API keys and Google OAuth credentials
npm run dev           # Start at http://localhost:3000
```

Users are redirected to Google sign-in on first visit (when `SESSION_SECRET` is set). For local dev without the OAuth flow, set `GOOGLE_REFRESH_TOKEN` in `.env.local` and leave `SESSION_SECRET` unset.

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
