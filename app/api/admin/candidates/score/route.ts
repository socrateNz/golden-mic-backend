import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { auditRepository } from '@/repositories/auditRepository';
import { handleCors, withCors } from '@/middleware/cors';

function verifyAdminToken(req: NextRequest): boolean {
  return req.headers.get('x-admin-token') === process.env.ADMIN_JWT_SECRET;
}

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }
  
  try {
    const body = await req.json();
    const { id, jury_ecriture, jury_technique, jury_attitude, jury_originalite, social_likes, social_comments, social_shares } = body;

    if (!id) {
      return withCors(NextResponse.json({ error: 'id requis' }, { status: 400 }), origin);
    }

    const data = {
      jury_ecriture: Number(jury_ecriture) || 0,
      jury_technique: Number(jury_technique) || 0,
      jury_attitude: Number(jury_attitude) || 0,
      jury_originalite: Number(jury_originalite) || 0,
      social_likes: Number(social_likes) || 0,
      social_comments: Number(social_comments) || 0,
      social_shares: Number(social_shares) || 0,
    };

    await candidateRepository.updateScoresAndSocials(id, data);

    await auditRepository.log({
      event_type: 'candidate.score_updated',
      entity_type: 'candidate',
      entity_id: id,
      actor_type: 'admin',
      details: { updated_by: 'admin', scores: data },
      severity: 'info',
    });

    return withCors(NextResponse.json({ success: true }), origin);
  } catch (error: any) {
    console.error("SCORE UPDATE ERROR:", error);
    const message = error?.message || 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
