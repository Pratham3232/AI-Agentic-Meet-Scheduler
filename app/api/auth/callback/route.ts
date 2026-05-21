import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { createOAuth2Client } from '@/lib/calendar/auth';
import { storeUserTokens } from '@/lib/auth/tokens';
import { setSessionCookie } from '@/lib/auth/cookie';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  if (error || !code) {
    return NextResponse.redirect(`${baseUrl}?auth_error=${error || 'no_code'}`);
  }

  try {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const email = userInfo.email;

    if (!email) {
      return NextResponse.redirect(`${baseUrl}?auth_error=no_email`);
    }

    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${baseUrl}?auth_error=no_refresh_token`);
    }

    await storeUserTokens(email, {
      access_token: tokens.access_token || '',
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? undefined,
      email,
    });

    await setSessionCookie(email);

    return NextResponse.redirect(baseUrl);
  } catch (err) {
    console.error('[auth/callback] Error:', err);
    return NextResponse.redirect(`${baseUrl}?auth_error=exchange_failed`);
  }
}
