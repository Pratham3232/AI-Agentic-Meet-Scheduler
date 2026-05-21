import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth/cookie';
import { getUserTokens } from '@/lib/auth/tokens';

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ authenticated: false });
  }

  const tokens = await getUserTokens(userId);
  if (!tokens) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    email: tokens.email,
  });
}
