import { NextRequest, NextResponse } from 'next/server';
import { transactionRepository } from '@/repositories/transactionRepository';
import { handleCors, withCors } from '@/middleware/cors';

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');

  // CORS preflight
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  try {
    const { searchParams } = new URL(req.url);
    const reference = searchParams.get('reference');

    if (!reference || !reference.trim()) {
      return withCors(
        NextResponse.json({ error: 'Référence requise' }, { status: 400 }),
        origin
      );
    }

    const transaction = await transactionRepository.findByReference(reference);

    if (!transaction) {
      return withCors(
        NextResponse.json(
          { error: 'Transaction introuvable', status: 'not_found' },
          { status: 404 }
        ),
        origin
      );
    }

    return withCors(
      NextResponse.json({
        success: true,
        data: {
          reference: transaction.reference,
          status: transaction.status,
          amount: transaction.amount,
          candidate_id: transaction.candidate_id,
          webhook_validated: transaction.webhook_validated,
          created_at: transaction.created_at,
          updated_at: transaction.updated_at,
        },
      }),
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
