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
  notchpay_id: string | null;
  notchpay_response: Record<string, unknown> | null;
  webhook_received_at: string | null;
  webhook_validated: boolean;
  ip_address: string | null;
  user_agent: string | null;
  points_awarded: number;
  idempotency_key: string | null;
  /** Fin de validité de la session de paiement (TTL côté app, voir NOTCHPAY_PAYMENT_TTL_MINUTES). */
  payment_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export const transactionRepository = {
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

  async markWebhookValidated(id: string, notchpayResponse: Record<string, unknown>) {
    const { error } = await supabase
      .from('transactions')
      .update({
        webhook_validated: true,
        webhook_received_at: new Date().toISOString(),
        notchpay_response: notchpayResponse,
        status: 'complete',
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
