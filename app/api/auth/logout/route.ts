import { NextResponse } from 'next/server';
import { clearSessionCookie, getSessionUserId } from '@/lib/auth/cookie';
import { deleteUserTokens } from '@/lib/auth/tokens';

export async function POST() {
  const userId = await getSessionUserId();
  if (userId) {
    await deleteUserTokens(userId);
  }
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}
