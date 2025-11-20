import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import fetch from "https://esm.sh/node-fetch@2.6.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60*60*1000).toISOString();
    const { data: upcoming } = await supabaseClient.from('matches').select('id, creator_id, opponent_id, scheduled_time, court_id').gte('scheduled_time', now.toISOString()).lte('scheduled_time', inOneHour);
    for (const m of (upcoming || [])) {
      const { data: court } = await supabaseClient.from('courts').select('*').eq('id', m.court_id).single();
      let weatherMsg = '';
      if (court && court.outdoor) {
        const owKey = Deno.env.get('OPENWEATHER_API_KEY') ?? '';
        const weatherRes = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${court.latitude}&lon=${court.longitude}&appid=${owKey}&units=metric`);
        const wjson = await weatherRes.json();
        weatherMsg = `Weather: ${wjson.weather?.[0]?.description || 'unknown'}, ${wjson.main?.temp}°C`;
      }
      const notifications = [];
      if (m.creator_id) notifications.push({ user_id: m.creator_id, type: 'reminder', title: 'Match Reminder', message: `Match in 1 hour. ${weatherMsg}`, metadata: { match_id: m.id } });
      if (m.opponent_id) notifications.push({ user_id: m.opponent_id, type: 'reminder', title: 'Match Reminder', message: `Match in 1 hour. ${weatherMsg}`, metadata: { match_id: m.id } });
      if (notifications.length) await supabaseClient.from('notifications').insert(notifications);
    }
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});