import { NextRequest, NextResponse } from 'next/server';
import {
  transactionRepository,
  type VoteLogFilters,
  type VoteLogStatus,
} from '@/repositories/transactionRepository';
import { handleCors, withCors } from '@/middleware/cors';

function verifyAdminToken(req: NextRequest): boolean {
  return req.headers.get('x-admin-token') === process.env.ADMIN_JWT_SECRET;
}

const STATUSES: VoteLogStatus[] = ['all', 'complete', 'processing', 'pending', 'failed', 'cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 200;

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

/**
 * GET /api/admin/votes — journal des votes depuis le début de la compétition.
 * Paramètres : status (complete par défaut | all | processing | pending | failed | cancelled),
 * candidateId, from / to (AAAA-MM-JJ), q (nom, téléphone, e-mail, référence),
 * page (1…), pageSize (≤ 200), all=1 (toutes les lignes, pour l'export).
 */
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }

  const sp = req.nextUrl.searchParams;
  const status = (sp.get('status') || 'complete') as VoteLogStatus;
  const candidateId = sp.get('candidateId') || undefined;
  const from = sp.get('from') || undefined;
  const to = sp.get('to') || undefined;
  const q = sp.get('q')?.trim().slice(0, 100) || undefined;

  if (!STATUSES.includes(status)) {
    return withCors(NextResponse.json({ error: 'Statut invalide' }, { status: 400 }), origin);
  }
  if (candidateId && !UUID_RE.test(candidateId)) {
    return withCors(NextResponse.json({ error: 'Candidat invalide' }, { status: 400 }), origin);
  }
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    return withCors(NextResponse.json({ error: 'Date invalide (AAAA-MM-JJ)' }, { status: 400 }), origin);
  }

  const filters: VoteLogFilters = { status, candidateId, from, to, q };

  try {
    if (sp.get('all') === '1') {
      const rows = await transactionRepository.listVoteLogAll(filters);
      return withCors(NextResponse.json({ success: true, data: { rows } }), origin);
    }

    const page = Math.max(1, Number.parseInt(sp.get('page') || '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(sp.get('pageSize') || '50', 10) || 50)
    );

    const [{ rows, total }, totals] = await Promise.all([
      transactionRepository.listVoteLog(filters, page, pageSize),
      transactionRepository.voteLogTotals(filters),
    ]);

    return withCors(
      NextResponse.json({
        success: true,
        data: { rows, total, page, pageSize, totals },
      }),
      origin
    );
  } catch (error) {
    console.error('GET ADMIN VOTES ERROR:', error);
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
