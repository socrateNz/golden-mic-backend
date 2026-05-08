import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { handleCors, withCors } from '@/middleware/cors';

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get('origin');
  const { id } = await params;

  const candidate = await candidateRepository.findById(id);
  if (!candidate) {
    return withCors(
      NextResponse.json({ error: 'Candidat introuvable' }, { status: 404 }),
      origin
    );
  }
  return withCors(NextResponse.json({ success: true, data: candidate }), origin);
}
