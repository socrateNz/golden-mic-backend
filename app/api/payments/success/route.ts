import { NextRequest, NextResponse } from 'next/server';
import { transactionRepository } from '@/repositories/transactionRepository';
import { handleCors, withCors } from '@/middleware/cors';

/**
 * Page de succès du paiement
 * Frontend redirige ici après que l'utilisateur complète le paiement
 */
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');

  try {
    const { searchParams } = new URL(req.url);
    const reference = searchParams.get('ref');

    if (!reference || !reference.trim()) {
      return withCors(
        NextResponse.json({ error: 'Référence manquante' }, { status: 400 }),
        origin
      );
    }

    const transaction = await transactionRepository.findByReference(reference);

    if (!transaction) {
      return withCors(
        NextResponse.json(
          {
            success: false,
            status: 'not_found',
            message: 'Transaction introuvable. Veuillez contacter le support.',
          },
          { status: 404 }
        ),
        origin
      );
    }

    // Retourner les détails actuels de la transaction
    return withCors(
      NextResponse.json({
        success: true,
        data: {
          reference: transaction.reference,
          status: transaction.status,
          amount: transaction.amount,
          webhook_validated: transaction.webhook_validated,
          created_at: transaction.created_at,
          updated_at: transaction.updated_at,
          message:
            transaction.status === 'complete'
              ? 'Paiement confirmé! Vos points ont été attribués.'
              : transaction.status === 'processing' || transaction.status === 'pending'
              ? 'Paiement en cours de traitement. Veuillez patienter...'
              : 'Paiement échoué. Veuillez réessayer.',
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
