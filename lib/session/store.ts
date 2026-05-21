import { Redis } from '@upstash/redis';
import { ConversationState } from '@/types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SESSION_TTL = 7200; // 2 hours in seconds

export async function getSession(sessionId: string): Promise<ConversationState | null> {
  const t0 = Date.now();
  try {
    const data = await redis.get<ConversationState>(`session:${sessionId}`);
    console.log(`[PERF][session] getSession: ${Date.now() - t0}ms`);
    return data;
  } catch (error) {
    console.error('Failed to get session:', error);
    console.log(`[PERF][session] getSession (error): ${Date.now() - t0}ms`);
    return null;
  }
}

export async function saveSession(state: ConversationState): Promise<void> {
  const t0 = Date.now();
  try {
    await redis.setex(`session:${state.sessionId}`, SESSION_TTL, JSON.stringify(state));
    console.log(`[PERF][session] saveSession: ${Date.now() - t0}ms`);
  } catch (error) {
    console.error('Failed to save session:', error);
    console.log(`[PERF][session] saveSession (error): ${Date.now() - t0}ms`);
    throw error;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const t0 = Date.now();
  try {
    await redis.del(`session:${sessionId}`);
    console.log(`[PERF][session] deleteSession: ${Date.now() - t0}ms`);
  } catch (error) {
    console.error('Failed to delete session:', error);
    console.log(`[PERF][session] deleteSession (error): ${Date.now() - t0}ms`);
  }
}

export function createInitialState(sessionId: string): ConversationState {
  return {
    sessionId,
    bookingJob: null,
    bookingPlanConfirmed: false,
    confirmedPlanSummary: null,
    cachedCalendar: null,
    calendarVersion: 0,
    pendingReschedule: null,
    slots: {
      duration: null,
      day: null,
      timeWindow: null,
      preferredStart: null,
      preferredEnd: null,
      attendees: [],
    },
    calendarResults: [],
    awaitingConfirmation: false,
    lastSearchParams: null,
    turnCount: 0,
    conversationHistory: [],
  };
}
