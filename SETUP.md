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
   
   Fill in your API keys in `.env.local`:
   - `OPENAI_API_KEY` — Get from OpenAI dashboard
   - Google Calendar credentials (see below)
   - Upstash Redis credentials (see below)

3. **Setup Google Calendar** (Option A — Recommended for dev)
   
   a. Go to [Google Cloud Console](https://console.cloud.google.com/)
   
   b. Create a new project or select existing
   
   c. Enable Google Calendar API:
      - Navigate to "APIs & Services" > "Library"
      - Search for "Google Calendar API"
      - Click "Enable"
   
   d. Create OAuth 2.0 Credentials:
      - Go to "APIs & Services" > "Credentials"
      - Click "Create Credentials" > "OAuth client ID"
      - Application type: "Web application"
      - Add authorized redirect URI: `http://localhost:3000/oauth2callback`
      - Download the credentials JSON
   
   e. Add credentials to `.env.local`:
      ```
      GOOGLE_CLIENT_ID=your_client_id
      GOOGLE_CLIENT_SECRET=your_client_secret
      ```
   
   f. Run the auth script to get refresh token:
      ```bash
      npm run auth:google
      ```
      This opens a browser, prompts sign-in, and outputs your refresh token.
   
   g. Add the refresh token to `.env.local`:
      ```
      GOOGLE_REFRESH_TOKEN=your_refresh_token
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

## Environment Variables Reference

```env
# Required
OPENAI_API_KEY=sk-...

# Google Calendar (OAuth2 — Option A)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=

# Google Calendar (Service Account — Option B, base64 of JSON key)
# GOOGLE_SERVICE_ACCOUNT_JSON=

# Calendar ID (use "primary" for the signed-in user's main calendar)
GOOGLE_CALENDAR_ID=primary

# Session store
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Alternative: Google Service Account (Production)

For production deployments, use a service account instead:

1. Go to Google Cloud Console > IAM & Admin > Service Accounts
2. Create a new service account
3. Download the JSON key file
4. Share your Google Calendar with the service account email (give "Make changes to events" permission)
5. Base64 encode the JSON and add to `.env.local`:
   ```bash
   cat service-account.json | base64
   ```
   ```
   GOOGLE_SERVICE_ACCOUNT_JSON=your_base64_encoded_json
   ```

## Testing

Run unit tests:
```bash
npm test
```

Run integration tests (requires valid credentials):
```bash
npm run test:integration
```

## Deployment

Deploy to Vercel:
```bash
npm i -g vercel
vercel login
vercel --prod
```

Add all environment variables in Vercel dashboard under Settings > Environment Variables.

The voice WebRTC connection goes directly from the browser to OpenAI — no server relay for audio, just the token-minting route (`/api/realtime/session`) and tool execution route (`/api/realtime/tools`) are server-side.

## Troubleshooting

**"Google OAuth2 credentials not configured"**
- Ensure all three Google env vars are set: CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN

**"Failed to get session" / Redis errors**
- Check Upstash credentials
- Ensure Redis database is active

**"Failed to fetch free slots"**
- Verify Calendar API is enabled in Google Cloud Console
- Check that calendar ID is correct (use "primary" for main calendar)
- Ensure refresh token is valid (re-run auth:google if needed)

**Voice connection failed / 404 on model**
- The voice pipeline uses `gpt-realtime-mini`. Ensure your OpenAI API key has access to the Realtime API.

**Webpack cache errors**
- Run `rm -rf .next` and restart the dev server
