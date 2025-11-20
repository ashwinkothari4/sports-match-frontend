import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MatchmakingRequest {
  userId: string;
  sport: string;
  location: { latitude: number; longitude: number; };
  schedule: string;
  playstyle: string;
  radius?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json();
    const { userId, sport, location, schedule, playstyle, radius = 10 } = body as MatchmakingRequest;

    // Get requesting user
    const { data: user, error: userError } = await supabaseClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    if (userError) throw userError;

    // Use simple RPC for now
    const { data: potentialOpponents, error: opponentsError } = await supabaseClient
      .rpc('find_nearby_users_simple', {
        user_lat: location.latitude,
        user_lon: location.longitude,
        max_distance: radius,
        current_user_id: userId,
        min_elo: user.elo - 200,
        max_elo: user.elo + 200
      });
    if (opponentsError) throw opponentsError;

    // recent opponents within 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: recentMatches } = await supabaseClient
      .from('match_history')
      .select('user1_id,user2_id,created_at')
      .gte('created_at', sevenDaysAgo.toISOString());

    const recentSet = new Set();
    (recentMatches || []).forEach((m: any) => {
      recentSet.add(String(m.user1_id));
      recentSet.add(String(m.user2_id));
    });

    const scored = [];
    for (const opp of (potentialOpponents || [])) {
      const eloDiff = Math.abs(user.elo - opp.elo);
      let score = Math.max(0, 100 - (eloDiff / 10));

      // availability check
      if (opp.availability) {
        try {
          const avail = typeof opp.availability === 'string' ? JSON.parse(opp.availability) : opp.availability;
          const matchTime = new Date(schedule);
          const matchHour = matchTime.getHours();
          const matchDay = matchTime.getDay();
          if (avail.preferred_times && Array.isArray(avail.preferred_times) &&
              avail.preferred_times.includes(matchHour) &&
              avail.preferred_days && Array.isArray(avail.preferred_days) &&
              avail.preferred_days.includes(matchDay)) {
            score += 15;
          }
        } catch (e) {
          // ignore
        }
      }

      if (opp.playstyle === playstyle) score += 20;
      if (recentSet.has(String(opp.id))) score -= 25;

      const midpoint = {
        latitude: (location.latitude + (opp.latitude || location.latitude)) / 2,
        longitude: (location.longitude + (opp.longitude || location.longitude)) / 2
      };

      scored.push({ user: opp, score: Math.max(0, score), distance: opp.distance, midpoint });
    }

    const top = scored.sort((a,b) => b.score - a.score).slice(0,3);

    return new Response(JSON.stringify({ success: true, opponents: top }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});