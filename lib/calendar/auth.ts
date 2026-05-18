import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

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
    'http://localhost:3000'
  );

  if (refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });
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
  let auth: OAuth2Client | any;

  if (process.env.GOOGLE_REFRESH_TOKEN) {
    auth = getOAuth2Client();
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const googleAuth = getServiceAccountClient();
    auth = await googleAuth.getClient();
  } else {
    throw new Error('No Google Calendar authentication configured');
  }

  return google.calendar({ version: 'v3', auth });
}
