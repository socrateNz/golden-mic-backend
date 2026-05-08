import { supabase } from '@/lib/supabase';

export const voteRepository = {
  async create(data: {
    transaction_id: string;
    candidate_id: string;
    points: number;
    amount: number;
    voter_phone?: string;
    voter_name?: string;
    ip_address?: string;
  }) {
    const { data: created, error } = await supabase
      .from('votes')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created;
  },

  async getRecentVotes(limit = 20) {
    const { data, error } = await supabase
      .from('votes')
      .select('id, points, amount, voter_name, created_at, candidates(artist_name, photo_url, slug)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async getCandidateVotes(candidateId: string) {
    const { data, error } = await supabase
      .from('votes')
      .select('id, points, amount, voter_name, created_at')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data;
  },
};
