import { Redis } from '@upstash/redis';
import { ConversationState } from '@/types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const SESSION_TTL = 7200; // 2 hours in seconds

export async function getSession(sessionId: string): Promise<ConversationState | null> {
  try {
    const data = await redis.get<ConversationState>(`session:${sessionId}`);
    return data;
  } catch (error) {
    console.error('Failed to get session:', error);
    return null;
  }
}

export async function saveSession(state: ConversationState): Promise<void> {
  try {
    await redis.setex(`session:${state.sessionId}`, SESSION_TTL, JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save session:', error);
    throw error;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await redis.del(`session:${sessionId}`);
  } catch (error) {
    console.error('Failed to delete session:', error);
  }
}

export function createInitialState(sessionId: string): ConversationState {
  return {
    sessionId,
    slots: {
      duration: null,
      day: null,
      timeWindow: null,
      attendees: [],
    },
    calendarResults: [],
    awaitingConfirmation: false,
    lastSearchParams: null,
    turnCount: 0,
    conversationHistory: [],
  };
}
