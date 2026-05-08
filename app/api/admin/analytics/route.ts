import { NextRequest, NextResponse } from 'next/server';
import { candidateRepository } from '@/repositories/candidateRepository';
import { transactionRepository } from '@/repositories/transactionRepository';
import { auditRepository } from '@/repositories/auditRepository';
import { handleCors, withCors } from '@/middleware/cors';

function verifyAdminToken(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-token');
  return token === process.env.ADMIN_JWT_SECRET;
}

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

// GET /api/admin/analytics
export async function GET(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!verifyAdminToken(req)) {
    return withCors(NextResponse.json({ error: 'Non autorisé' }, { status: 401 }), origin);
  }

  try {
    const [allCandidates, revenueData, fraudLogs, auditLogs] = await Promise.all([
      candidateRepository.findAllAdmin(),
      transactionRepository.getRevenueStats(),
      auditRepository.getFraudAttempts(50),
      auditRepository.getRecentLogs(50),
    ]);

    const totalRevenue = revenueData.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalVotes = revenueData.length;

    const statusCounts = allCandidates.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Revenue par jour (30 derniers jours)
    const revenueByDay = revenueData.reduce((acc, t) => {
      const day = t.created_at.slice(0, 10);
      acc[day] = (acc[day] ?? 0) + Number(t.amount);
      return acc;
    }, {} as Record<string, number>);

    return withCors(
      NextResponse.json({
        success: true,
        data: {
          summary: {
            totalCandidates: allCandidates.length,
            totalRevenue,
            totalVotes,
            candidatesByStatus: statusCounts,
          },
          revenueByDay: Object.entries(revenueByDay)
            .map(([date, amount]) => ({ date, amount }))
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30),
          fraudAttempts: fraudLogs,
          recentLogs: auditLogs,
        },
      }),
      origin
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur serveur';
    return withCors(NextResponse.json({ error: message }, { status: 500 }), origin);
  }
}
