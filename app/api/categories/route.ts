import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
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
    const categoryOrder = ['rap', 'mbole', 'chant-rnb-soul', 'afropop', 'autre'] as const;
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, slug')
      .eq('is_active', true);

    if (error) throw error;
    const allCategories = data ?? [];
    const preferredSet = new Set(categoryOrder);
    const preferred = allCategories.filter((c) => preferredSet.has(c.slug as (typeof categoryOrder)[number]));
    const others = allCategories.filter((c) => !preferredSet.has(c.slug as (typeof categoryOrder)[number]));

    const orderedPreferred = preferred.sort(
      (a, b) => categoryOrder.indexOf(a.slug as (typeof categoryOrder)[number]) - categoryOrder.indexOf(b.slug as (typeof categoryOrder)[number])
    );

    const orderedData = [...orderedPreferred, ...others];

    return withCors(
      NextResponse.json({
        success: true,
        data: orderedData,
      }),
      origin
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}

