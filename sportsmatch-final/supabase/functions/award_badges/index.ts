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
    const { userId } = await req.json();
    if (!userId) return new Response(JSON.stringify({ error: 'userId required' }), { headers: { ...corsHeaders }, status: 400 });
    const { data: user } = await supabaseClient.from('users').select('*').eq('id', userId).single();
    if (!user) return new Response(JSON.stringify({ error: 'user not found' }), { headers: { ...corsHeaders }, status: 404 });
    const { data: achievements } = await supabaseClient.from('achievements').select('*');
    for (const a of (achievements || [])) {
      let qualifies = false;
      if (a.requirement_type === 'wins' && user.wins >= a.requirement_value) qualifies = true;
      if (a.requirement_type === 'elo' && user.elo >= a.requirement_value) qualifies = true;
      if (a.requirement_type === 'matches' && user.total_matches >= a.requirement_value) qualifies = true;
      if (qualifies) {
        const { data: existing } = await supabaseClient.from('user_achievements').select('*').eq('user_id', userId).eq('achievement_id', a.id);
        if (!existing || existing.length === 0) {
          await supabaseClient.from('user_achievements').insert({ user_id: userId, achievement_id: a.id });
          await supabaseClient.from('notifications').insert({ user_id: userId, type: 'achievement', title: 'New Achievement', message: `You earned ${a.name}`, metadata: { achievement_id: a.id } });
        }
      }
    }
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});