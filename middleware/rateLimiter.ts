import { Ratelimit } from '@upstash/ratelimit';
import { redis } from '@/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

// 10 requêtes par minute par IP pour les votes
const voteRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  analytics: true,
  prefix: 'gm237:vote:rl',
});

// 30 requêtes par minute pour les lectures
const readRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  analytics: true,
  prefix: 'gm237:read:rl',
});

export function getClientIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '127.0.0.1'
  );
}

export async function applyVoteRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const ip = getClientIP(req);
  const { success, limit, reset, remaining } = await voteRateLimit.limit(ip);

  if (!success) {
    return NextResponse.json(
      { error: 'Trop de requêtes. Veuillez patienter avant de voter à nouveau.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
          'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    );
  }
  return null;
}

export async function applyReadRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const ip = getClientIP(req);
  const { success } = await readRateLimit.limit(ip);
  if (!success) {
    return NextResponse.json({ error: 'Trop de requêtes.' }, { status: 429 });
  }
  return null;
}
