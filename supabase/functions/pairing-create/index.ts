import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

type PairingCreateBody = {
  context?: 'search' | 'bulk';
  context_ref?: string | null;
  device_id?: string | null;
  ttl_seconds?: number;
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

    const authedClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: userData, error: userError } = await authedClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = (await req.json()) as PairingCreateBody;
    const context = body.context === 'bulk' ? 'bulk' : 'search';
    const ttlSeconds = Math.min(Math.max(Number(body.ttl_seconds) || 45, 15), 90);
    const challenge = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
    const expiresAt = new Date(Date.now() + (ttlSeconds * 1000)).toISOString();

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await admin
      .from('pairing_challenges')
      .insert({
        challenge,
        created_by_user_id: userData.user.id,
        device_id: body.device_id || null,
        context,
        context_ref: body.context_ref || null,
        expires_at: expiresAt
      })
      .select('id, challenge, expires_at, context, context_ref')
      .single();

    if (error) throw error;

    const qrPayload = JSON.stringify({
      type: 'scan_pairing',
      pairing_id: data.id,
      challenge: data.challenge
    });

    return new Response(JSON.stringify({
      pairing_id: data.id,
      challenge: data.challenge,
      expires_at: data.expires_at,
      context: data.context,
      context_ref: data.context_ref,
      pairing_qr_payload: qrPayload
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

