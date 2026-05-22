import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session/store';
import { getCancelProgress } from '@/lib/agent/cancel-executor';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const state = await getSession(sessionId);
  if (!state?.cancelJob) {
    return NextResponse.json({ progress: null });
  }

  return NextResponse.json({
    progress: getCancelProgress(state.cancelJob),
    confirmedCancelSummary: state.confirmedCancelSummary ?? null,
  });
}
