# Project Structure Overview

## Complete File Tree

```
agenticMeetScheduler/
├── app/
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts              # Main orchestration endpoint
│   │   ├── calendar/
│   │   │   ├── free-slots/
│   │   │   │   └── route.ts          # Freebusy query wrapper
│   │   │   └── create-event/
│   │   │       └── route.ts          # Event creation wrapper
│   │   └── voice/
│   │       └── route.ts              # Voice session token endpoint
│   ├── page.tsx                      # Main chat UI page
│   ├── layout.tsx                    # Root layout
│   └── globals.css                   # Global styles
│
├── lib/
│   ├── agent/
│   │   ├── state.ts                  # State management & reducers
│   │   ├── prompt.ts                 # System prompt builder
│   │   ├── tools.ts                  # LLM tool schemas
│   │   ├── slot-filler.ts            # Slot extraction from messages
│   │   ├── conflict-resolver.ts      # Alternative slot search
│   │   └── time-parser.ts            # Natural language time parsing
│   ├── calendar/
│   │   ├── auth.ts                   # Google OAuth2 setup
│   │   ├── freebusy.ts               # Find available slots
│   │   ├── events.ts                 # Create/lookup events
│   │   └── utils.ts                  # Formatting helpers
│   └── session/
│       └── store.ts                  # Redis session management
│
├── components/
│   ├── ChatWindow.tsx                # Message display container
│   ├── MessageBubble.tsx             # Individual message component
│   └── VoiceButton.tsx               # Voice input toggle
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
├── Readme.md                         # Assignment documentation
├── SETUP.md                          # Setup instructions
└── PROJECT_STRUCTURE.md              # This file
```

## Layer Architecture

### Layer 1 — Voice I/O
**Files:** `app/api/voice/route.ts`, `components/VoiceButton.tsx`

Handles speech-to-text and text-to-speech integration with OpenAI Realtime API.

### Layer 2 — Orchestration Backend
**Files:** `app/api/chat/route.ts`, `lib/agent/*`, `lib/session/store.ts`

Core conversation logic:
- Maintains conversation state across turns
- Routes user messages to appropriate actions
- Implements slot-filling pattern
- Runs conflict resolution when needed

### Layer 3 — LLM Brain
**Files:** `lib/agent/prompt.ts`, `lib/agent/tools.ts`, `lib/agent/time-parser.ts`

LLM integration:
- Dynamic system prompt generation
- Tool schema definitions
- Natural language time parsing

### Layer 4 — Google Calendar Tools
**Files:** `lib/calendar/*`

Calendar API wrappers:
- OAuth2 authentication
- Freebusy queries
- Event creation
- Event lookup

## Key Components

### API Routes

#### `/api/chat` (Main Orchestration)
- Receives user messages
- Manages conversation state
- Calls LLM with tools
- Executes calendar operations
- Returns assistant responses

#### `/api/calendar/free-slots`
- Direct freebusy query endpoint
- Takes: startTime, endTime, duration
- Returns: array of available TimeSlots

#### `/api/calendar/create-event`
- Direct event creation endpoint
- Takes: summary, startTime, endTime, attendees
- Returns: created CalendarEvent

#### `/api/voice`
- Returns OpenAI Realtime API session token
- Enables voice interaction

### Library Modules

#### `lib/agent/state.ts`
State management functions:
- `updateSlot()` - Update individual slot
- `addMessage()` - Add to conversation history
- `hasAllRequiredSlots()` - Check if ready to search
- `getNextMissingSlot()` - Determine what to ask next
- `resetSlots()` - Clear all slots

#### `lib/agent/slot-filler.ts`
Extracts structured data from user messages:
- Duration parsing (minutes/hours)
- Day parsing (today, tomorrow, ISO dates)
- Time window parsing (morning/afternoon/evening)
- Email address extraction

#### `lib/agent/conflict-resolver.ts`
3-step fallback chain when no slots found:
1. Expand time window to full day
2. Try adjacent days (±1)
3. Try next 3 weekdays

#### `lib/agent/time-parser.ts`
Natural language time expression parsing:
- Quick patterns (today, tomorrow, next week)
- LLM-based parsing for complex expressions
- Returns TimeExpression with confidence score

#### `lib/agent/prompt.ts`
Builds dynamic system prompt including:
- Current conversation state
- Collected slots
- Available calendar results
- Next required information

#### `lib/calendar/auth.ts`
Google Calendar authentication:
- OAuth2 client setup
- Service account support
- Token refresh handling

#### `lib/calendar/freebusy.ts`
Calendar availability queries:
- Queries Google Calendar freebusy API
- Generates 15-minute increment slots
- Filters by meeting duration

#### `lib/calendar/events.ts`
Event operations:
- `createEvent()` - Insert calendar event
- `lookupEvent()` - Search existing events

#### `lib/session/store.ts`
Redis-backed session management:
- `getSession()` - Retrieve conversation state
- `saveSession()` - Persist state (2hr TTL)
- `createInitialState()` - New session factory

### Frontend Components

#### `app/page.tsx`
Main chat interface:
- Message display
- Text input
- Voice button
- API communication

#### `components/ChatWindow.tsx`
Message container with:
- Auto-scroll to latest
- Loading indicator
- Message list rendering

#### `components/MessageBubble.tsx`
Individual message display:
- User/assistant styling
- Content rendering

#### `components/VoiceButton.tsx`
Voice input control:
- Microphone permission
- Recording state indicator
- Toggle voice mode

## Data Flow

```
User Input (Text/Voice)
    ↓
app/page.tsx
    ↓
POST /api/chat
    ↓
Load Session (Redis)
    ↓
Extract Slots (slot-filler.ts)
    ↓
Build System Prompt (prompt.ts)
    ↓
Call OpenAI with Tools
    ↓
    ├── Text Response → Return to user
    │
    └── Tool Call
        ├── find_free_slots
        │   ↓
        │   Calendar Freebusy API
        │   ↓
        │   If empty → Conflict Resolver
        │   ↓
        │   Return slots to user
        │
        ├── create_event
        │   ↓
        │   Calendar Insert API
        │   ↓
        │   Return confirmation
        │
        └── lookup_event
            ↓
            Calendar Search API
            ↓
            Return event details
    ↓
Save Session (Redis)
    ↓
Return Response to Frontend
```

## Configuration Files

### `package.json`
Dependencies:
- **next** - Framework
- **openai** - LLM integration
- **googleapis** - Calendar API
- **date-fns** - Date manipulation
- **@upstash/redis** - Session storage
- **uuid** - Session ID generation

Scripts:
- `npm run dev` - Start development server
- `npm run build` - Production build
- `npm test` - Run unit tests
- `npm run auth:google` - Generate refresh token

### `.env.local.example`
Required environment variables:
- OpenAI API key
- Google OAuth2 credentials
- Upstash Redis credentials
- App configuration

### `tsconfig.json`
TypeScript configuration:
- Strict mode enabled
- Path aliases (@/*)
- Next.js plugin

### `vercel.json`
Deployment settings:
- 30s function timeout
- API route configuration

## Next Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.local.example .env.local
   # Fill in your API keys
   ```

3. **Setup Google Calendar:**
   ```bash
   npm run auth:google
   ```

4. **Run development server:**
   ```bash
   npm run dev
   ```

See `SETUP.md` for detailed setup instructions.
