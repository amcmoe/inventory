import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};


type PairingConsumeBody = {
  pairing_id?: string;
  challenge?: string;
  device_id?: string | null;
  session_ttl_seconds?: number;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = (await req.json()) as PairingConsumeBody;
    const pairingId = body.pairing_id?.trim();
    const challenge = body.challenge?.trim();
    if (!pairingId || !challenge) {
      throw new Error('pairing_id and challenge are required');
    }

    // Single-use consume gate.
    const { data: consumed, error: consumeError } = await admin
      .from('pairing_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', pairingId)
      .eq('challenge', challenge)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id, created_by_user_id, device_id, context, context_ref')
      .single();

    if (consumeError || !consumed) {
      return new Response(JSON.stringify({ error: 'Pairing invalid, expired, or already used' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (consumed.device_id && body.device_id && consumed.device_id !== body.device_id) {
      return new Response(JSON.stringify({ error: 'Pairing is restricted to a different scanner device' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const ttlSeconds = Math.min(Math.max(Number(body.session_ttl_seconds) || 900, 60), 1800);
    const expiresAt = new Date(Date.now() + (ttlSeconds * 1000)).toISOString();

    const { data: session, error: sessionError } = await admin
      .from('scan_sessions')
      .insert({
        created_by_user_id: consumed.created_by_user_id,
        device_id: consumed.device_id || body.device_id || null,
        pairing_challenge_id: consumed.id,
        context: consumed.context,
        context_ref: consumed.context_ref,
        status: 'active',
        expires_at: expiresAt
      })
      .select('id, expires_at, context, context_ref')
      .single();

    if (sessionError) throw sessionError;

    return new Response(JSON.stringify({
      scan_session_id: session.id,
      expires_at: session.expires_at,
      context: session.context,
      context_ref: session.context_ref,
      server_now: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

