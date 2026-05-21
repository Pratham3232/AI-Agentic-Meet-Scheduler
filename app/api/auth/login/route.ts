import { NextResponse } from 'next/server';
import { createOAuth2Client } from '@/lib/calendar/auth';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
];

export async function GET() {
  const client = createOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
  return NextResponse.redirect(url);
}
