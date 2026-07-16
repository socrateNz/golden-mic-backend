import { supabase } from '@/lib/supabase';

export interface GamePhaseRow {
  id: string;
  name: string;
  status: 'active' | 'completed';
  eliminated_count: number;
  created_at: string;
  completed_at: string | null;
}

export const phaseRepository = {
  async getActivePhase() {
    const { data, error } = await supabase
      .from('game_phases')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 is not found
    return data as GamePhaseRow | null;
  },

  async getAllPhases() {
    const { data, error } = await supabase
      .from('game_phases')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data as GamePhaseRow[];
  },

  async transitionPhase(nextPhaseName: string, eliminationCount: number) {
    // We should ideally do this in a single transaction or an RPC to be safe,
    // but we can do it via API since Supabase JS client doesn't support 
    // explicit transactions from the frontend unless we use an RPC.
    // For simplicity, we'll do it sequentially here, or better, we create an RPC.
    
    // We will do it sequentially since it's an admin operation and traffic is low during transition.
    
    const activePhase = await this.getActivePhase();

    // 1. Find candidates to eliminate
    const { data: candidatesToEliminate, error: err1 } = await supabase
      .from('candidates')
      .select('id')
      .eq('status', 'approved')
      .eq('is_eliminated', false)
      .order('note_totale', { ascending: true }) // Ascending so lowest points are first
      .limit(eliminationCount);
      
    if (err1) throw err1;

    const idsToEliminate = candidatesToEliminate?.map(c => c.id) || [];

    // 2. Eliminate candidates
    if (idsToEliminate.length > 0) {
      const { error: err2 } = await supabase
        .from('candidates')
        .update({ is_eliminated: true })
        .in('id', idsToEliminate);
      if (err2) throw err2;
    }

    // 3. Mark current phase as completed
    if (activePhase) {
      const { error: err3 } = await supabase
        .from('game_phases')
        .update({ 
          status: 'completed', 
          completed_at: new Date().toISOString(),
          eliminated_count: eliminationCount 
        })
        .eq('id', activePhase.id);
      if (err3) throw err3;
    }

    // 4. Reset phase scores for all active candidates
    const { error: err4 } = await supabase
      .from('candidates')
      .update({
        phase_vote_points: 0,
        phase_jury_ecriture: 0,
        phase_jury_technique: 0,
        phase_jury_attitude: 0,
        phase_jury_originalite: 0,
        phase_social_likes: 0,
        phase_social_comments: 0,
        phase_social_shares: 0,
      })
      .eq('status', 'approved')
      .eq('is_eliminated', false);
      
    if (err4) throw err4;

    // 5. Create new phase
    const { data: newPhase, error: err5 } = await supabase
      .from('game_phases')
      .insert({ name: nextPhaseName, status: 'active' })
      .select()
      .single();
      
    if (err5) throw err5;

    return newPhase;
  }
};
