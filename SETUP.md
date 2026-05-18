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
   
   Then fill in your API keys in `.env.local`:
   - `OPENAI_API_KEY` - Get from OpenAI dashboard
   - Google Calendar credentials (see below)
   - Upstash Redis credentials (see below)

3. **Setup Google Calendar** (Option A - Recommended for dev)
   
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
      - Download the JSON file
   
   e. Add credentials to `.env.local`:
      ```
      GOOGLE_CLIENT_ID=your_client_id
      GOOGLE_CLIENT_SECRET=your_client_secret
      ```
   
   f. Run the auth script to get refresh token:
      ```bash
      npm run auth:google
      ```
      This will open a browser, sign in with Google, and output your refresh token.
   
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

## Alternative: Google Service Account (Production)

For production deployments, use a service account instead:

1. Go to Google Cloud Console > IAM & Admin > Service Accounts
2. Create a new service account
3. Download the JSON key file
4. Share your Google Calendar with the service account email
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

## Troubleshooting

**"Google OAuth2 credentials not configured"**
- Ensure all three Google env vars are set: CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN

**"Failed to get session" / Redis errors**
- Check Upstash credentials
- Ensure Redis database is active

**"Failed to fetch free slots"**
- Verify calendar API is enabled in Google Cloud Console
- Check that calendar ID is correct (use "primary" for main calendar)
- Ensure refresh token is valid (re-run auth:google if needed)
