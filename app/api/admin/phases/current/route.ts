import { NextResponse } from 'next/server';
import { phaseRepository } from '@/repositories/phaseRepository';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const currentPhase = await phaseRepository.getActivePhase();
    return NextResponse.json({ currentPhase });
  } catch (error: any) {
    console.error('Erreur lors de la récupération de la phase:', error);
    return NextResponse.json({ error: 'Erreur interne', details: error.message }, { status: 500 });
  }
}
