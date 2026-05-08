import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { candidatesQuerySchema } from '@/validators/schemas';
import { applyReadRateLimit } from '@/middleware/rateLimiter';
import { handleCors, withCors } from '@/middleware/cors';

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  const corsCheck = handleCors(req);
  if (corsCheck) return corsCheck;

  const rateLimitResponse = await applyReadRateLimit(req);
  if (rateLimitResponse) return withCors(rateLimitResponse, origin);

  try {
    const { searchParams } = new URL(req.url);
    const params = candidatesQuerySchema.parse({
      page: searchParams.get('page'),
      limit: searchParams.get('limit'),
      region: searchParams.get('region') ?? undefined,
      categoryId: searchParams.get('categoryId') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      sort: searchParams.get('sort') ?? 'points',
    });

    const { data, count } = await candidateRepository.findAll(params);

    return withCors(
      NextResponse.json({
        success: true,
        data,
        meta: {
          total: count,
          page: params.page,
          limit: params.limit,
          totalPages: Math.ceil(count / params.limit),
        },
      }),
      origin
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
