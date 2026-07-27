import { NextRequest, NextResponse } from 'next/server';
import { phaseRepository } from '@/repositories/phaseRepository';
import { handleCors, withCors } from '@/middleware/cors';

function verifyAdminToken(req: NextRequest): boolean {
  return req.headers.get('x-admin-token') === process.env.ADMIN_JWT_SECRET;
}

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }

  try {
    const { id: candidateId } = await params;
    if (!candidateId) {
      return withCors(NextResponse.json({ error: 'candidateId requis' }, { status: 400 }), origin);
    }

    const history = await phaseRepository.getCandidatePhaseHistory(candidateId);
    return withCors(NextResponse.json({ history }), origin);
  } catch (error: any) {
    console.error("GET CANDIDATE HISTORY ERROR:", error);
    const message = error?.message || 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
