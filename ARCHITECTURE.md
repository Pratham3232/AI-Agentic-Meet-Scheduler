# Smart Scheduler AI — Architecture & Latency Profile

## Request-Response Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER BROWSER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌───────────┐    ┌─────────────────┐  │
│  │ Voice In │───▶│ MediaRecorder│───▶│ VAD (RMS) │───▶│ Auto-stop after │  │
│  │ (mic)    │    │ (webm/opus)  │    │ Web Audio │    │ 1.5s silence    │  │
│  └──────────┘    └──────────────┘    └───────────┘    └────────┬────────┘  │
│                                                                 │           │
│                                                                 ▼           │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    PARALLEL AFTER CHAT RESPONSE                       │   │
│  │                                                                       │   │
│  │  ┌─────────────────┐         ┌──────────────────────────────────┐    │   │
│  │  │ Display text    │ ◀─ immediate                                │    │   │
│  │  │ (setMessages)   │         │  fetch /api/tts (background)     │    │   │
│  │  └─────────────────┘         │  → streams audio/mpeg           │    │   │
│  │                               │  → Audio().play() when ready    │    │   │
│  │                               └──────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Backend Pipeline (Next.js API Routes)

```
POST /api/transcribe                    POST /api/chat                         POST /api/tts
─────────────────────                   ──────────────                          ─────────────

Audio blob (webm)                       { message, sessionId, timezone }       { text }
       │                                         │                                   │
       ▼                                         ▼                                   ▼
┌─────────────────┐                    ┌──────────────────────┐              ┌──────────────────┐
│ OpenAI Whisper  │                    │ 1. Slot Extraction   │              │ OpenAI tts-1     │
│ (whisper-1)     │                    │    (rule-based,      │              │ voice: nova      │
│                 │                    │     <1ms)            │              │ format: mp3      │
│ ~800ms          │                    └──────────┬───────────┘              │                  │
└────────┬────────┘                               │                          │ ~2.5-3s TTFB    │
         │                                        ▼                          │ (server-side gen)│
         ▼                             ┌──────────────────────┐              └────────┬─────────┘
  { text: "..." }                      │ 2. Auto-search       │                       │
                                       │    (if all slots     │                       ▼
                                       │     filled)          │              ReadableStream
                                       │    → Google Calendar │              piped to client
                                       │      FreeBusy API    │
                                       │    ~300-500ms        │
                                       └──────────┬───────────┘
                                                  │
                                                  ▼
                                       ┌──────────────────────┐
                                       │ 3. Redis session     │
                                       │    load/save         │
                                       │    ~50ms             │
                                       └──────────┬───────────┘
                                                  │
                                                  ▼
                                       ┌──────────────────────┐
                                       │ 4. LLM Call          │
                                       │    (gpt-4o-mini)     │
                                       │    + tool loop       │
                                       │    ~1.5-2.5s         │
                                       └──────────┬───────────┘
                                                  │
                                                  ▼
                                       ┌──────────────────────┐
                                       │ 5. VOICE: tag parse  │
                                       │    or rule-based     │
                                       │    fallback (<1ms)   │
                                       └──────────┬───────────┘
                                                  │
                                                  ▼
                                       { message, voiceScript, state }
```

## Latency Breakdown (Measured)

| Stage | Time | Blocking? |
|-------|------|-----------|
| STT (Whisper API) | ~800ms | Yes (before chat) |
| Slot extraction (regex) | <1ms | Yes |
| Redis load (Upstash) | ~50ms | Yes |
| Auto-search (Google Calendar FreeBusy) | ~300-500ms | Yes (only when all slots filled) |
| LLM (gpt-4o-mini, 1 turn) | ~1.5s | Yes |
| LLM (with tool call + 2nd turn) | ~3s | Yes |
| Redis save | ~50ms | Yes |
| **Total chat API** | **~2-3.5s** | — |
| TTS generation (tts-1, server-side) | ~2.5-3s | No (parallel, text shown first) |
| TTS audio download | ~500ms | No (streams) |

## End-to-End Timing (Voice Flow)

```
Time ──────────────────────────────────────────────────────────────────▶

0s          1.5s        2.5s        3.5s        5s          6s
│           │           │           │           │           │
├───────────┤           │           │           │           │
│  RECORD   │           │           │           │           │
│  + VAD    │           │           │           │           │
│           ├───────────┤           │           │           │
│           │  WHISPER  │           │           │           │
│           │  STT      │           │           │           │
│           │           ├───────────┤           │           │
│           │           │  CHAT API │           │           │
│           │           │  (LLM +   │           │           │
│           │           │  Calendar)│           │           │
│           │           │           │◀── TEXT SHOWS HERE     │
│           │           │           │           │           │
│           │           │           ├───────────────────────┤
│           │           │           │  TTS GENERATING       │
│           │           │           │  (parallel,           │
│           │           │           │   non-blocking)       │
│           │           │           │           │           │◀── AUDIO PLAYS
```

## Key Components & Files

| File | Role | Latency impact |
|------|------|---------------|
| `app/page.tsx` | Frontend orchestration, VAD, playback | Text display: 0ms after API returns |
| `app/api/chat/route.ts` | Main orchestrator, auto-search, LLM loop | Critical path: 2-3.5s |
| `app/api/tts/route.ts` | Streams OpenAI TTS audio | Non-blocking: 2.5-3s |
| `app/api/transcribe/route.ts` | Whisper STT | Pre-chat: ~800ms |
| `lib/agent/slot-filler.ts` | Rule-based NLU (regex) | <1ms |
| `lib/agent/prompt.ts` | System prompt construction | <1ms |
| `lib/calendar/freebusy.ts` | Google Calendar queries | ~300-500ms |
| `lib/calendar/utils.ts` | Time window calculation + now-clamping | <1ms |
| `lib/voice-script.ts` | Rule-based voice summary fallback | <1ms |
| `lib/session/store.ts` | Upstash Redis session | ~50ms per op |
| `lib/agent/conflict-resolver.ts` | Fallback slot search strategies | 0-1500ms (only when no slots) |

## Potential Latency Reduction Vectors

| Approach | Saves | Trade-off |
|----------|-------|-----------|
| Streaming LLM response (show tokens as they arrive) | ~1-2s perceived | Complex frontend, partial text |
| Edge-deployed TTS (Cartesia, ElevenLabs Turbo) | ~1.5s on TTS | Cost, vendor lock-in |
| WebSocket for chat (avoid HTTP overhead) | ~100ms | Complexity |
| In-memory session (skip Redis) | ~100ms | No persistence across restarts |
| Pre-warm TTS (start generation before LLM finishes) | ~1s | Waste if LLM changes output |
| gpt-4o-mini → gpt-4.1-nano (faster model) | ~500ms | Quality trade-off |
| Local Whisper (whisper.cpp) | ~500ms on STT | Infra, CPU cost |
| WebRTC Realtime API (OpenAI) | Eliminates STT+TTS pipeline entirely | $$$, completely different arch |

## Current Optimisations Already Applied

1. Text shown immediately — not blocked by TTS
2. TTS streams audio/mpeg via chunked transfer (no server buffering)
3. Auto-search: if slot-filler fills all 3 slots, find_free_slots runs before LLM (saves 1 LLM round-trip)
4. gpt-4o-mini instead of gpt-4o (2-3x faster, 10x cheaper)
5. Rule-based slot extraction (<1ms vs extra LLM call)
6. Voice script from LLM's VOICE: tag (no extra summarisation call)
7. VAD auto-stop (no manual mic click delay)
8. Short voice scripts (~15-25 words → faster TTS generation)
9. tts-1 model (lowest latency TTS model, speed: 1.05x)
10. Time window clamped to now (prevents invalid slots → no wasted LLM correction turns)
