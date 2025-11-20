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
    const { matchId, creatorScore, opponentScore } = await req.json();
    const { data: match, error: matchError } = await supabaseClient.from('matches').select('*, creator:users(*), opponent:users(*)').eq('id', matchId).single();
    if (matchError) throw matchError;

    const outcome = creatorScore > opponentScore ? 1 : creatorScore < opponentScore ? 0 : 0.5;
    const eloChange = calculateELO(match.creator.elo, match.opponent.elo, outcome);

    const creatorUpdates = { elo: eloChange.player1, wins: match.creator.wins + (outcome === 1 ? 1 : 0), losses: match.creator.losses + (outcome === 0 ? 1 : 0), total_matches: match.creator.total_matches + 1 };
    const opponentUpdates = { elo: eloChange.player2, wins: match.opponent.wins + (outcome === 0 ? 1 : 0), losses: match.opponent.losses + (outcome === 1 ? 1 : 0), total_matches: match.opponent.total_matches + 1 };

    await supabaseClient.from('matches').update({ status: 'completed', match_score: { creator: creatorScore, opponent: opponentScore } }).eq('id', matchId);

    await supabaseClient.from('users').update(creatorUpdates).eq('id', match.creator_id);
    await supabaseClient.from('users').update(opponentUpdates).eq('id', match.opponent_id);

    await supabaseClient.from('match_history').insert({
      match_id: matchId,
      user1_id: match.creator_id,
      user2_id: match.opponent_id,
      user1_elo_before: match.creator.elo,
      user1_elo_after: eloChange.player1,
      user2_elo_before: match.opponent.elo,
      user2_elo_after: eloChange.player2
    });

    await supabaseClient.functions.invoke('award_badges', { body: { userId: match.creator_id, matchId } });
    await supabaseClient.functions.invoke('award_badges', { body: { userId: match.opponent_id, matchId } });

    return new Response(JSON.stringify({ success: true, eloChange }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});

function calculateELO(player1ELO, player2ELO, outcome, kFactor = 32) {
  const expected1 = 1 / (1 + Math.pow(10, (player2ELO - player1ELO) / 400));
  const expected2 = 1 / (1 + Math.pow(10, (player1ELO - player2ELO) / 400));
  const newELO1 = Math.round(player1ELO + kFactor * (outcome - expected1));
  const newELO2 = Math.round(player2ELO + kFactor * ((1 - outcome) - expected2));
  return { player1: newELO1, player2: newELO2, change1: newELO1 - player1ELO, change2: newELO2 - player2ELO };
}