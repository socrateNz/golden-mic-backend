import { supabase } from '@/lib/supabase';

export interface TransactionRow {
  id: string;
  reference: string;
  candidate_id: string;
  voter_name: string | null;
  voter_email: string | null;
  voter_phone: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'complete' | 'failed' | 'cancelled';
  payment_method: string | null;
  /** Colonnes historiques (ex-NotchPay) : stockent désormais le token MoneyFusion et sa réponse brute. */
  notchpay_id: string | null;
  notchpay_response: Record<string, unknown> | null;
  webhook_received_at: string | null;
  webhook_validated: boolean;
  ip_address: string | null;
  user_agent: string | null;
  points_awarded: number;
  idempotency_key: string | null;
  /** Fin de validité de la session de paiement (TTL côté app, voir MONEYFUSION_PAYMENT_TTL_MINUTES). */
  payment_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type VoteLogStatus = TransactionRow['status'] | 'all';

export interface VoteLogFilters {
  status: VoteLogStatus;
  candidateId?: string;
  /** AAAA-MM-JJ, journée entière à l'heure de Douala (UTC+1) */
  from?: string;
  to?: string;
  /** Recherche dans le nom, le téléphone, l'e-mail ou la référence */
  q?: string;
}

const VOTE_LOG_SELECT =
  'id, reference, voter_name, voter_phone, voter_email, amount, currency, status, payment_method, created_at, webhook_received_at, candidate_id, candidates(artist_name, slug), votes(points)';

// Supabase renvoie au plus 1000 lignes par requête : les totaux sont calculés par tranches.
const SUPABASE_MAX_ROWS = 1000;

// Les types génériques du constructeur de requêtes Supabase sont trop complexes à contraindre ici :
// on applique les filtres sur une vue `any`, le type d'entrée est conservé en sortie.
function applyVoteLogFilters<Q>(query: Q, f: VoteLogFilters): Q {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (f.status !== 'all') q = q.eq('status', f.status);
  if (f.candidateId) q = q.eq('candidate_id', f.candidateId);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00+01:00`);
  if (f.to) q = q.lte('created_at', `${f.to}T23:59:59.999+01:00`);
  if (f.q) {
    // Caractères qui casseraient la syntaxe du filtre `or` de PostgREST
    const term = f.q.replace(/[,()*%\\:"']/g, ' ').trim();
    if (term) {
      q = q.or(
        ['voter_name', 'voter_phone', 'voter_email', 'reference']
          .map((col) => `${col}.ilike.*${term}*`)
          .join(',')
      );
    }
  }
  return q as Q;
}

export const transactionRepository = {
  /** Journal des votes (admin) : une page de transactions, les plus récentes d'abord. */
  async listVoteLog(filters: VoteLogFilters, page: number, pageSize: number) {
    const fromIdx = (page - 1) * pageSize;
    const { data, error, count } = await applyVoteLogFilters(
      supabase.from('transactions').select(VOTE_LOG_SELECT, { count: 'exact' }),
      filters
    )
      .order('created_at', { ascending: false })
      .range(fromIdx, fromIdx + pageSize - 1);
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
  },

  /** Toutes les lignes correspondant aux filtres (export), par tranches de 1000. */
  async listVoteLogAll(filters: VoteLogFilters) {
    const rows: unknown[] = [];
    for (let fromIdx = 0; ; fromIdx += SUPABASE_MAX_ROWS) {
      const { data, error } = await applyVoteLogFilters(
        supabase.from('transactions').select(VOTE_LOG_SELECT),
        filters
      )
        .order('created_at', { ascending: false })
        .range(fromIdx, fromIdx + SUPABASE_MAX_ROWS - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < SUPABASE_MAX_ROWS) break;
    }
    return rows;
  },

  /** Totaux des paiements VALIDÉS correspondant aux filtres (montant et points). */
  async voteLogTotals(filters: VoteLogFilters) {
    let count = 0;
    let amount = 0;
    let points = 0;
    for (let fromIdx = 0; ; fromIdx += SUPABASE_MAX_ROWS) {
      const { data, error } = await applyVoteLogFilters(
        supabase.from('transactions').select('id, amount, votes(points)'),
        { ...filters, status: 'complete' }
      )
        .order('created_at', { ascending: false })
        .range(fromIdx, fromIdx + SUPABASE_MAX_ROWS - 1);
      if (error) throw error;
      for (const row of data ?? []) {
        count += 1;
        amount += Number(row.amount);
        const v = row.votes as { points: number } | { points: number }[] | null;
        points += Array.isArray(v) ? v.reduce((s, x) => s + Number(x.points), 0) : Number(v?.points ?? 0);
      }
      if ((data?.length ?? 0) < SUPABASE_MAX_ROWS) break;
    }
    return { count, amount, points };
  },

  async create(data: Partial<TransactionRow>) {
    const { data: created, error } = await supabase
      .from('transactions')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as TransactionRow;
  },

  async findByReference(reference: string) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference', reference)
      .single();
    if (error) return null;
    return data as TransactionRow;
  },

  async findByReferenceOrNotchpayId(refOrId: string) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .or(`reference.eq.${refOrId},notchpay_id.eq.${refOrId}`)
      .single();
    if (error) return null;
    return data as TransactionRow;
  },

  async findByIdempotencyKey(key: string) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('idempotency_key', key)
      .single();
    if (error) return null;
    return data as TransactionRow;
  },

  async updateStatus(
    id: string,
    status: TransactionRow['status'],
    extra?: Partial<TransactionRow>
  ) {
    const { error } = await supabase
      .from('transactions')
      .update({ status, ...extra })
      .eq('id', id);
    if (error) throw error;
  },

  async markWebhookValidated(
    id: string,
    notchpayResponse: Record<string, unknown>,
    extra?: Partial<TransactionRow>
  ) {
    const { error } = await supabase
      .from('transactions')
      .update({
        webhook_validated: true,
        webhook_received_at: new Date().toISOString(),
        notchpay_response: notchpayResponse,
        status: 'complete',
        ...extra,
      })
      .eq('id', id);
    if (error) throw error;
  },

  async getRevenueStats() {
    const { data, error } = await supabase
      .from('transactions')
      .select('amount, created_at')
      .eq('status', 'complete');
    if (error) throw error;
    return data;
  },
};
