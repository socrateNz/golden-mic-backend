import { NextResponse } from 'next/server';
import { phaseRepository } from '@/repositories/phaseRepository';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { nextPhaseName, eliminationCount } = body;

    if (!nextPhaseName || typeof eliminationCount !== 'number') {
      return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
    }

    const newPhase = await phaseRepository.transitionPhase(nextPhaseName, eliminationCount);

    return NextResponse.json({ success: true, newPhase });
  } catch (error: any) {
    console.error('Erreur lors de la transition de phase:', error);
    return NextResponse.json({ error: 'Erreur interne', details: error.message }, { status: 500 });
  }
}
