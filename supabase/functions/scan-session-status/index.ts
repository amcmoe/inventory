import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

type ScanSessionStatusBody = {
  scan_session_id?: string;
  pairing_id?: string;
  challenge?: string;
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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';
    const body = (await req.json()) as ScanSessionStatusBody;
    const scanSessionId = body.scan_session_id?.trim();
    if (!scanSessionId) {
      throw new Error('scan_session_id is required');
    }

    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData } = await authedClient.auth.getUser();

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: session, error: readError } = await admin
      .from('scan_sessions')
      .select('id, created_by_user_id, status, expires_at, ended_at, pairing_challenge_id, remote_mode, remote_asset_tag')
      .eq('id', scanSessionId)
      .single();
    if (readError || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const authedUserId = userData?.user?.id ?? null;
    let allowed = false;

    if (authedUserId && session.created_by_user_id === authedUserId) {
      allowed = true;
    }

    if (!allowed) {
      const pairingId = body.pairing_id?.trim();
      const challenge = body.challenge?.trim();
      if (pairingId && challenge) {
        const { data: pairing, error: pairingError } = await admin
          .from('pairing_challenges')
          .select('id, challenge, consumed_at')
          .eq('id', pairingId)
          .eq('challenge', challenge)
          .single();
        if (
          !pairingError &&
          pairing &&
          pairing.id === session.pairing_challenge_id &&
          Boolean(pairing.consumed_at)
        ) {
          allowed = true;
        }
      }
    }

    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      status: session.status,
      expires_at: session.expires_at,
      ended_at: session.ended_at,
      remote_mode: session.remote_mode || 'scan',
      remote_asset_tag: session.remote_asset_tag || null
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
