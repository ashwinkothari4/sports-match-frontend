import { supabase } from './supabaseClient';

export const userAPI = {
  async getPublicProfile(userId) {
    const { data, error } = await supabase.from('public_users').select('*').eq('id', userId).single();
    return { data, error };
  },
  async getCurrentUserProfile(userId) {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    return { data, error };
  }
};

export const matchmakingAPI = {
  async suggestOpponent(payload) {
    // Replace with actual function invocation or endpoint
    const res = await fetch('/.netlify/functions/matchmaking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.json();
  }
};

export const leaderboardAPI = {
  async getLeaderboard(limit = 50) {
    const { data, error } = await supabase.from('public_users').select('*').order('elo', { ascending: false }).limit(limit);
    return { data, error };
  }
};
