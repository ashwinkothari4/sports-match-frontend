import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

export const useRealtimeMatches = (userId) => {
  const [matches, setMatches] = useState([]);
  useEffect(() => {
    const subscription = supabase.channel('matches')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `or(creator_id.eq.${userId},opponent_id.eq.${userId})` }, (payload) => {
        if (payload.eventType === 'INSERT') setMatches(prev => [payload.new, ...prev]);
        if (payload.eventType === 'UPDATE') setMatches(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
        if (payload.eventType === 'DELETE') setMatches(prev => prev.filter(m => m.id !== payload.old.id));
      }).subscribe();
    return () => subscription.unsubscribe();
  }, [userId]);
  return matches;
};
