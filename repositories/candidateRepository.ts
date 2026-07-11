import { supabase } from '@/lib/supabase';

export interface CandidateRow {
  id: string;
  full_name: string;
  artist_name: string;
  slug: string;
  date_of_birth: string;
  region: string;
  category_id: string | null;
  phone: string;
  email: string | null;
  biography: string | null;
  photo_url: string | null;
  photo_public_id: string | null;
  video_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  tiktok_url: string | null;
  youtube_url: string | null;
  total_points: number;
  vote_count: number;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  rejection_reason: string | null;
  is_trending: boolean;
  rank: number | null;
  created_at: string;
  updated_at: string;
  jury_ecriture: number;
  jury_technique: number;
  jury_attitude: number;
  jury_originalite: number;
  social_likes: number;
  social_comments: number;
  social_shares: number;
  categories?: { name: string; slug: string } | null;
}

export const candidateRepository = {
  async findAll(params: {
    page: number;
    limit: number;
    region?: string;
    categoryId?: string;
    search?: string;
    sort: string;
  }) {
    let query = supabase
      .from('candidates')
      .select('*, categories(name, slug)', { count: 'exact' })
      .eq('status', 'approved');

    if (params.region) query = query.eq('region', params.region);
    if (params.categoryId) query = query.eq('category_id', params.categoryId);
    if (params.search) {
      query = query.or(
        `artist_name.ilike.%${params.search}%,full_name.ilike.%${params.search}%`
      );
    }

    const sortMap: Record<string, string> = {
      points: 'total_points',
      votes: 'vote_count',
      recent: 'created_at',
    };
    query = query.order(sortMap[params.sort] ?? 'total_points', { ascending: false });

    const offset = (params.page - 1) * params.limit;
    query = query.range(offset, offset + params.limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data as CandidateRow[], count: count ?? 0 };
  },

  async findById(id: string) {
    const { data, error } = await supabase
      .from('candidates')
      .select('*, categories(name, slug)')
      .eq('id', id)
      .eq('status', 'approved')
      .single();
    if (error) return null;
    return data as CandidateRow;
  },

  async findBySlug(slug: string) {
    const { data, error } = await supabase
      .from('candidates')
      .select('*, categories(name, slug)')
      .eq('slug', slug)
      .eq('status', 'approved')
      .single();
    if (error) return null;
    return data as CandidateRow;
  },

  async incrementPoints(id: string, points: number) {
    const { error } = await supabase.rpc('increment_candidate_points', {
      candidate_id: id,
      points_to_add: points,
    });
    if (error) throw error;
  },

  async create(data: Omit<CandidateRow, 'id' | 'total_points' | 'vote_count' | 'rank' | 'created_at' | 'updated_at'>) {
    const { data: created, error } = await supabase
      .from('candidates')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return created as CandidateRow;
  },

  async getLeaderboard(limit = 50) {
    const { data, error } = await supabase
      .from('candidates')
      .select('id, artist_name, slug, photo_url, total_points, vote_count, rank, region, categories(name)')
      .eq('status', 'approved')
      .order('total_points', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  // Admin
  async findAllAdmin(status?: string) {
    let query = supabase
      .from('candidates')
      .select('*, categories(name)')
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return data as CandidateRow[];
  },

  async updateStatus(id: string, status: string, reason?: string) {
    const { error } = await supabase
      .from('candidates')
      .update({ status, rejection_reason: reason ?? null })
      .eq('id', id);
    if (error) throw error;
  },

  async update(id: string, data: Partial<Omit<CandidateRow, 'id' | 'total_points' | 'vote_count' | 'rank' | 'created_at' | 'updated_at' | 'jury_ecriture' | 'jury_technique' | 'jury_attitude' | 'jury_originalite' | 'social_likes' | 'social_comments' | 'social_shares'>>) {
    const { data: updated, error } = await supabase
      .from('candidates')
      .update(data)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return updated as CandidateRow;
  },

  async updateScoresAndSocials(id: string, data: {
    jury_ecriture: number;
    jury_technique: number;
    jury_attitude: number;
    jury_originalite: number;
    social_likes: number;
    social_comments: number;
    social_shares: number;
  }) {
    const { error } = await supabase
      .from('candidates')
      .update(data)
      .eq('id', id);
    if (error) throw error;
  },

  async delete(id: string) {
    const { error } = await supabase
      .from('candidates')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};
