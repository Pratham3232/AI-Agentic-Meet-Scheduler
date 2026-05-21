import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { AsyncLocalStorage } from 'async_hooks';

const calendarAuthStore = new AsyncLocalStorage<OAuth2Client>();

export function createOAuth2Client(redirectUri?: string): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth2 credentials not configured');
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback`
  );
}

export function createUserOAuth2Client(refreshToken: string, accessToken?: string): OAuth2Client {
  const client = createOAuth2Client();
  client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken,
  });
  return client;
}

/**
 * Run an async function with a user-specific OAuth2Client.
 * All calls to getCalendarClient() inside `fn` will use this client.
 */
export function withCalendarAuth<T>(auth: OAuth2Client, fn: () => Promise<T>): Promise<T> {
  return calendarAuthStore.run(auth, fn);
}

export function getOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth2 credentials not configured');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/callback`
  );

  if (refreshToken) {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
  }

  return oauth2Client;
}

export function getServiceAccountClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('Service account JSON not configured');
  }
  const credentials = JSON.parse(
    Buffer.from(serviceAccountJson, 'base64').toString()
  );
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

export async function getCalendarClient() {
  const t0 = Date.now();

  // 1. Per-request user auth (from withCalendarAuth)
  const userAuth = calendarAuthStore.getStore();
  if (userAuth) {
    const client = google.calendar({ version: 'v3', auth: userAuth });
    console.log(`[PERF][calendar] getCalendarClient (user-auth): ${Date.now() - t0}ms`);
    return client;
  }

  // 2. Fallback: global env-based auth (single-user / dev mode)
  let auth: OAuth2Client | any;
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    auth = getOAuth2Client();
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const googleAuth = getServiceAccountClient();
    auth = await googleAuth.getClient();
  } else {
    throw new Error('No Google Calendar authentication configured');
  }

  const client = google.calendar({ version: 'v3', auth });
  console.log(`[PERF][calendar] getCalendarClient (env-auth): ${Date.now() - t0}ms`);
  return client;
}
