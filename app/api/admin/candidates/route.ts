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

// GET /api/admin/candidates — Liste tous les candidats
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const data = await candidateRepository.findAllAdmin(status);
  return withCors(NextResponse.json({ success: true, data }), origin);
}

// PATCH /api/admin/candidates — Valider / Rejeter / Suspendre
export async function PATCH(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }
  try {
    const { id, status, reason } = await req.json();
    if (!id || !status) {
      return withCors(NextResponse.json({ error: 'id et status requis' }, { status: 400 }), origin);
    }
    const allowed = ['approved', 'rejected', 'suspended', 'pending'];
    if (!allowed.includes(status)) {
      return withCors(NextResponse.json({ error: 'Statut invalide' }, { status: 400 }), origin);
    }
    await candidateRepository.updateStatus(id, status, reason);
    await auditRepository.log({
      event_type: `candidate.${status}`,
      entity_type: 'candidate',
      entity_id: id,
      actor_type: 'admin',
      details: { reason },
      severity: 'info',
    });
    return withCors(NextResponse.json({ success: true }), origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
