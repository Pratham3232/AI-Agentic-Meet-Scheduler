import { OAuth2Client } from 'google-auth-library';
import { getSessionUserId } from './cookie';
import { getUserTokens } from './tokens';
import { createUserOAuth2Client } from '../calendar/auth';

/**
 * Resolves the OAuth2Client for the current request.
 * 1. If a user is logged in via cookie, uses their personal tokens.
 * 2. Falls back to null (caller should let getCalendarClient use env vars).
 */
export async function resolveCalendarAuth(): Promise<OAuth2Client | null> {
  try {
    const userId = await getSessionUserId();
    if (!userId) return null;

    const tokens = await getUserTokens(userId);
    if (!tokens?.refresh_token) return null;

    return createUserOAuth2Client(tokens.refresh_token, tokens.access_token);
  } catch {
    return null;
  }
}
