import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { channel, event, payload } = await req.json();
    if (channel.startsWith('matches:')) {
      const matchId = channel.replace('matches:','');
      const { data: match } = await supabaseClient.from('matches').select('creator_id,opponent_id').eq('id', matchId).single();
      const notifications = [];
      if (match?.creator_id) notifications.push({ user_id: match.creator_id, type: 'match_update', title: 'Match Updated', message: `Match ${event}`, metadata: { match_id: matchId, payload } });
      if (match?.opponent_id) notifications.push({ user_id: match.opponent_id, type: 'match_update', title: 'Match Updated', message: `Match ${event}`, metadata: { match_id: matchId, payload } });
      if (notifications.length) await supabaseClient.from('notifications').insert(notifications);
    } else if (channel.startsWith('friends:')) {
      const userId = channel.replace('friends:','');
      await supabaseClient.from('notifications').insert({ user_id: userId, type: 'friend_update', title: 'Friend Update', message: `Friend activity: ${event}`, metadata: { payload } });
    } else if (channel === 'leaderboard') {
      await supabaseClient.from('notifications').insert({ user_id: null, type: 'system', title: 'Leaderboard updated', message: `Leaderboard: ${event}`, metadata: { payload } });
    }
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});