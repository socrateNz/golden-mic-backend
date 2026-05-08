import { supabase } from '@/lib/supabase';

export const auditRepository = {
  async log(data: {
    event_type: string;
    entity_type?: string;
    entity_id?: string;
    actor_type: 'admin' | 'system' | 'webhook' | 'user';
    actor_id?: string;
    details?: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
    severity?: 'info' | 'warning' | 'error' | 'critical';
  }) {
    try {
      await supabase.from('audit_logs').insert({
        event_type: data.event_type,
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        actor_type: data.actor_type,
        actor_id: data.actor_id,
        details: data.details,
        ip_address: data.ip_address,
        user_agent: data.user_agent,
        severity: data.severity ?? 'info',
      });
    } catch (error) {
      // Audit logs must never break the main flow
      console.error('[Audit] Failed to write log:', error);
    }
  },

  async logFraud(data: {
    ip_address: string;
    user_agent?: string;
    attempt_type: string;
    details?: Record<string, unknown>;
    transaction_reference?: string;
  }) {
    try {
      await supabase.from('fraud_attempts').insert(data);
    } catch (error) {
      console.error('[Fraud] Failed to log attempt:', error);
    }
  },

  async getRecentLogs(limit = 100) {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async getFraudAttempts(limit = 100) {
    const { data, error } = await supabase
      .from('fraud_attempts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },
};
