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
    const now = new Date().toISOString();
    const { data: toExpire } = await supabaseClient.from('matches').select('id').lt('scheduled_time', now).eq('status','scheduled');
    for (const m of (toExpire || [])) {
      await supabaseClient.from('matches').update({ status: 'expired' }).eq('id', m.id);
      await supabaseClient.from('match_history').insert({ match_id: m.id, user1_id: null, user2_id: null, user1_elo_before: 0, user1_elo_after: 0, user2_elo_before: 0, user2_elo_after: 0 });
    }
    return new Response(JSON.stringify({ success: true, expired: (toExpire || []).length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});