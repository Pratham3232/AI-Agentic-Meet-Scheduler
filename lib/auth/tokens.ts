import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expiry_date?: number;
  email: string;
}

export async function storeUserTokens(userId: string, tokens: StoredTokens): Promise<void> {
  await redis.setex(`auth:${userId}`, TOKEN_TTL, JSON.stringify(tokens));
}

export async function getUserTokens(userId: string): Promise<StoredTokens | null> {
  try {
    const data = await redis.get<StoredTokens>(`auth:${userId}`);
    return data;
  } catch {
    return null;
  }
}

export async function deleteUserTokens(userId: string): Promise<void> {
  await redis.del(`auth:${userId}`);
}
