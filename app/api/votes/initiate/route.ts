import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { voteService } from '@/services/voteService';
import { initiateVoteSchema } from '@/validators/schemas';
import { applyVoteRateLimit, getClientIP } from '@/middleware/rateLimiter';
import { handleCors, withCors } from '@/middleware/cors';

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');

  // CORS preflight
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  // Rate limiting
  const rateLimitResponse = await applyVoteRateLimit(req);
  if (rateLimitResponse) return withCors(rateLimitResponse, origin);

  try {
    const body = await req.json();

    // Validation Zod
    const parsed = initiateVoteSchema.safeParse(body);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 }),
        origin
      );
    }

    const ip = getClientIP(req);
    const userAgent = req.headers.get('user-agent') ?? 'unknown';

    const result = await voteService.initiateVote(parsed.data, { ipAddress: ip, userAgent });

    after(() => {
      void voteService.pollAggregatorUntilTransactionSettled(result.reference, {
        ipAddress: ip,
        userAgent,
      });
    });

    return withCors(
      NextResponse.json({ success: true, data: result }, { status: 201 }),
      origin
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(
      NextResponse.json({ error: message }, { status: 500 }),
      origin
    );
  }
}
