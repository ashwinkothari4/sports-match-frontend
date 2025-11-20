import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2023-10-16' });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.headers.get('stripe-signature')) {
    return handleStripeWebhook(req);
  }
  return handlePaymentRequest(req);
});

async function handlePaymentRequest(req) {
  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  try {
    const { userId, priceId, successUrl, cancelUrl } = await req.json();
    const { data: user, error: userError } = await supabaseClient.from('users').select('*').eq('id', userId).single();
    if (userError) throw userError;

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { supabase_id: userId } });
      customerId = customer.id;
      await supabaseClient.from('users').update({ stripe_customer_id: customerId }).eq('id', userId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId }
    });

    return new Response(JSON.stringify({ sessionId: session.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
}

async function handleStripeWebhook(req) {
  const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const body = await req.text();
  const signature = req.headers.get('stripe-signature') ?? '';
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await handleSubscriptionUpdate(supabaseClient, subscription);
    }
    return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
}

async function handleSubscriptionUpdate(supabaseClient, subscription) {
  const { data: user } = await supabaseClient.from('users').select('*').eq('stripe_customer_id', subscription.customer).single();
  if (!user) return;
  let tier = 'free';
  if (subscription.status === 'active') {
    const priceId = subscription.items.data[0].price.id;
    const playPlusPriceId = Deno.env.get('STRIPE_PLAY_PLUS_PRICE_ID');
    const elitePriceId = Deno.env.get('STRIPE_ELITE_PRICE_ID');
    if (priceId === playPlusPriceId) tier = 'play_plus';
    if (priceId === elitePriceId) tier = 'elite';
  }
  await supabaseClient.from('users').update({ subscription_tier: tier, stripe_subscription_id: subscription.id }).eq('id', user.id);
}