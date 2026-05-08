import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGIN = process.env.FRONTEND_URL ?? 'http://localhost:3000';

export function corsHeaders(origin: string | null) {
  const isAllowed = origin === ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': isAllowed ? ALLOWED_ORIGIN : '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleCors(req: NextRequest): NextResponse | null {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  return null;
}

export function withCors(response: NextResponse, origin: string | null): NextResponse {
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}
