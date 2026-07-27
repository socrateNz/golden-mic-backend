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

  async getCandidatePhaseHistory(candidateId: string) {
    const { data, error } = await supabase
      .from('candidate_phase_scores')
      .select('*')
      .eq('candidate_id', candidateId)
      .order('created_at', { ascending: true });
      
    if (error) throw error;
    return data;
  },

  async transitionPhase(nextPhaseName: string, eliminationCount: number) {
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

    // 3. Save snapshot in history table before resetting
    if (activePhase) {
      const { data: currentCandidates } = await supabase
        .from('candidates')
        .select('*')
        .eq('status', 'approved');

      if (currentCandidates && currentCandidates.length > 0) {
        const historyRows = currentCandidates.map(c => {
          const isEliminatedNow = idsToEliminate.includes(c.id) || c.is_eliminated;
          const votePoints = c.phase_vote_points || 0;
          const juryE = c.phase_jury_ecriture || c.jury_ecriture || 0;
          const juryT = c.phase_jury_technique || c.jury_technique || 0;
          const juryA = c.phase_jury_attitude || c.jury_attitude || 0;
          const juryO = c.phase_jury_originalite || c.jury_originalite || 0;
          const sLikes = c.phase_social_likes || c.social_likes || 0;
          const sComments = c.phase_social_comments || c.social_comments || 0;
          const sShares = c.phase_social_shares || c.social_shares || 0;
          const totalScore = votePoints + juryE + juryT + juryA + juryO + sLikes + (sComments * 2) + (sShares * 5);

          return {
            candidate_id: c.id,
            phase_id: activePhase.id,
            phase_name: activePhase.name,
            vote_points: votePoints,
            jury_ecriture: juryE,
            jury_technique: juryT,
            jury_attitude: juryA,
            jury_originalite: juryO,
            social_likes: sLikes,
            social_comments: sComments,
            social_shares: sShares,
            total_score: totalScore,
            is_eliminated_in_phase: isEliminatedNow,
          };
        });

        await supabase
          .from('candidate_phase_scores')
          .upsert(historyRows, { onConflict: 'candidate_id,phase_id' });
      }

      // Mark current phase as completed
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
