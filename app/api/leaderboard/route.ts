import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { voteRepository } from '@/repositories/voteRepository';
import { handleCors, withCors } from '@/middleware/cors';

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  try {
    const [candidates, recentVotes] = await Promise.all([
      candidateRepository.getLeaderboard(50),
      voteRepository.getRecentVotes(20),
    ]);

    return withCors(
      NextResponse.json({
        success: true,
        data: {
          leaderboard: candidates,
          recentVotes,
          updatedAt: new Date().toISOString(),
        },
      }),
      origin
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
