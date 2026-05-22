# Setup Instructions

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   ```bash
   cp .env.local.example .env.local
   ```
   
   Fill in your API keys in `.env.local` (see full reference below).

3. **Setup Google Calendar OAuth**
   
   a. Go to [Google Cloud Console](https://console.cloud.google.com/)
   
   b. Create a new project or select existing
   
   c. Enable Google Calendar API:
      - Navigate to "APIs & Services" > "Library"
      - Search for "Google Calendar API"
      - Click "Enable"
   
   d. Configure OAuth Consent Screen:
      - Go to "APIs & Services" > "OAuth consent screen"
      - Choose "External" user type
      - Fill in app name and support email
      - Add scopes: `calendar.events`, `calendar.readonly`, `userinfo.email`
      - Add test users (required while app is in "Testing" status)
      - To allow any Google user: click "Publish App" (users will see an "unverified app" warning but can proceed via Advanced → Continue)
   
   e. Create OAuth 2.0 Credentials:
      - Go to "APIs & Services" > "Credentials"
      - Click "Create Credentials" > "OAuth client ID"
      - Application type: "Web application"
      - Add authorized redirect URI: `http://localhost:3000/api/auth/callback`
      - Download or copy the Client ID and Client Secret
   
   f. Add credentials to `.env.local`:
      ```
      GOOGLE_CLIENT_ID=your_client_id
      GOOGLE_CLIENT_SECRET=your_client_secret
      NEXT_PUBLIC_APP_URL=http://localhost:3000
      SESSION_SECRET=any-random-string-at-least-32-chars
      ```

4. **Setup Upstash Redis**
   
   a. Go to [Upstash](https://upstash.com/)
   
   b. Create a free account
   
   c. Create a new Redis database
   
   d. Copy the REST URL and token to `.env.local`:
      ```
      UPSTASH_REDIS_REST_URL=your_redis_url
      UPSTASH_REDIS_REST_TOKEN=your_redis_token
      ```

5. **Run Development Server**
   ```bash
   npm run dev
   ```
   
   Open [http://localhost:3000](http://localhost:3000)
   
   You will be redirected to Google sign-in. After authentication, you'll land on the chat interface with access to your Google Calendar.

## Environment Variables Reference

```env
# Required — OpenAI
OPENAI_API_KEY=sk-...

# Required — Google Calendar OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Required — Upstash Redis (sessions + per-user OAuth tokens)
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# Required for per-user OAuth (production)
NEXT_PUBLIC_APP_URL=http://localhost:3000       # Your app URL (no trailing slash)
SESSION_SECRET=your-random-secret-string         # HMAC signing key for session cookies

# Optional — Calendar ID (defaults to "primary")
GOOGLE_CALENDAR_ID=primary

# Optional — Fallback for dev without OAuth flow
# When SESSION_SECRET is unset, the app skips auth and uses this token directly
GOOGLE_REFRESH_TOKEN=your_refresh_token
```

### Dev Mode (Without OAuth Flow)

For quick local development without setting up the full OAuth flow:

1. Leave `SESSION_SECRET` unset (or empty) in `.env.local`
2. Set `GOOGLE_REFRESH_TOKEN` with a token obtained via `npm run auth:google`
3. The middleware will pass all requests through without authentication
4. All calendar operations use the static refresh token from `.env.local`

To generate a refresh token for dev mode:
```bash
npm run auth:google
```
This opens a browser, prompts sign-in, and outputs your refresh token.

## Production Deployment

### Vercel

```bash
npm i -g vercel
vercel login
vercel link
vercel --prod
```

### Environment Variables

Add via CLI (`vercel env add <KEY>`) or Vercel dashboard (Settings > Environment Variables).
Select **all three environments** (Production, Preview, Development) for each:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | Your OpenAI API key |
| `GOOGLE_CLIENT_ID` | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `UPSTASH_REDIS_REST_URL` | Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Redis REST token |
| `NEXT_PUBLIC_APP_URL` | Your deployed URL (e.g., `https://your-app.vercel.app`) |
| `SESSION_SECRET` | Random string for HMAC signing (generate with `openssl rand -hex 32`) |
| `GOOGLE_CALENDAR_ID` | `primary` (or specific calendar ID) |

After adding env vars, redeploy: `vercel --prod`

### Google Cloud Console Update

After deploying, add your production redirect URI:
1. Go to Google Cloud Console > APIs & Services > Credentials
2. Edit your OAuth client
3. Add authorized redirect URI: `https://your-app.vercel.app/api/auth/callback`
4. Keep `http://localhost:3000/api/auth/callback` for local development

### Publishing the App for Public Access

To allow any Google user to sign in (not just test users):
1. Go to Google Cloud Console > APIs & Services > OAuth consent screen
2. Click "Publish App" → Confirm
3. Users will see an "unverified app" warning but can proceed via Advanced → "Go to <app name> (unsafe)"
4. Scopes used are `calendar.events`, `calendar.readonly`, `userinfo.email` (all "sensitive", not "restricted") — no Google verification required

### Function Timeouts

Timeouts are configured via `export const maxDuration` in each route file (App Router pattern). No `vercel.json` functions config needed:
- `/api/chat` — 30s (LLM agentic loop + calendar queries)
- `/api/realtime/tools` — 15s (calendar tool execution)
- `/api/realtime/session` — 10s (OpenAI token mint)
- `/api/auth/callback` — 10s (Google token exchange)
- `/api/booking/run` — SSE-streamed batch execution
- `/api/cancel/run` — SSE-streamed batch execution

### Notes

- The voice WebRTC connection goes directly from the browser to OpenAI — no server relay for audio
- Only the token-minting route (`/api/realtime/session`) and tool execution route (`/api/realtime/tools`) are server-side
- Edge middleware runs at Vercel's edge locations for low-latency auth verification
- Redis stores both session state (2-hour TTL) and OAuth tokens (30-day TTL)
- `vercel.json` only sets `{"framework": "nextjs"}` — all other config is in-code
- Batch booking and cancel SSE routes handle their own progress streaming

## Testing

Run unit tests (17 test suites):
```bash
npm test
```

Test suites cover:
- State management, slot extraction, booking job lifecycle
- Booking context reconciliation, day resolution, SSE lock management
- Cancel job lifecycle, event identification, reschedule flow
- Event cache operations, multi-day planner, plan building
- Slot availability checks, client progress handler
- Realtime voice response gating, day rail component

Run integration tests (requires valid credentials):
```bash
npm run test:integration
```

## Troubleshooting

**Redirected to login in a loop**
- Ensure `SESSION_SECRET` is set and matches between restarts
- Check that your Google OAuth consent screen has your email as a test user (or app is published)
- Verify the redirect URI in Google Cloud Console matches exactly: `<NEXT_PUBLIC_APP_URL>/api/auth/callback`

**Google OAuth 400 error for new users**
- Verify `NEXT_PUBLIC_APP_URL` matches your actual deployed URL exactly (no trailing slash)
- Ensure OAuth scopes are `calendar.events` + `calendar.readonly` + `userinfo.email` (not the restricted `calendar` scope)
- If the app is in "Testing" status, only test users can sign in — publish the app for public access

**"Google OAuth2 credentials not configured"**
- Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- For dev mode without OAuth: set `GOOGLE_REFRESH_TOKEN` and leave `SESSION_SECRET` unset

**Chat shown without login in incognito/production**
- Ensure `SESSION_SECRET` is set in the **Production** environment (not just Development)
- Verify via `vercel env ls` that it shows for Production
- Redeploy after adding: `vercel --prod`

**"Failed to get session" / Redis errors**
- Check Upstash credentials
- Ensure Redis database is active

**"Failed to fetch free slots" / "The specified time range is empty"**
- Verify Calendar API is enabled in Google Cloud Console
- Check that the user granted calendar permissions during OAuth
- For dev mode: ensure refresh token is valid (re-run `npm run auth:google`)
- If using working hours where evening window is empty (e.g., end hour = 17), the system auto-falls back to default time windows

**Voice connection failed / 404 on model**
- The voice pipeline uses `gpt-realtime-mini`. Ensure your OpenAI API key has access to the Realtime API.

**Webpack cache errors (Cannot find module './276.js')**
- Run `rm -rf .next` and restart the dev server

**Agent reports wrong date (e.g., yesterday's date)**
- All date computation uses timezone-aware `formatInTimeZone()`. Ensure your browser is sending the correct timezone.

**Batch booking/cancel not completing**
- Check that SSE routes (`/api/booking/run`, `/api/cancel/run`) are accessible
- Verify the booking/cancel job was initialized before the batch execute call
- Check browser console for SSE connection errors
