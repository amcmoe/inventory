import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type ControlBody = {
  scan_session_id?: string;
  mode?: 'scan' | 'damage';
  asset_tag?: string | null;
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

    const body = (await req.json()) as ControlBody;
    const scanSessionId = String(body.scan_session_id || '').trim();
    const mode = body.mode === 'damage' ? 'damage' : 'scan';
    const assetTag = mode === 'damage' ? String(body.asset_tag || '').trim() : '';

    if (!scanSessionId) {
      throw new Error('scan_session_id is required');
    }
    if (mode === 'damage' && !assetTag) {
      throw new Error('asset_tag is required for damage mode');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: session, error: readError } = await admin
      .from('scan_sessions')
      .select('id, created_by_user_id, status, expires_at')
      .eq('id', scanSessionId)
      .single();
    if (readError || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (session.created_by_user_id !== userData.user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const exp = new Date(session.expires_at).getTime();
    if (session.status !== 'active' || Number.isNaN(exp) || exp <= Date.now()) {
      return new Response(JSON.stringify({ error: 'Session is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { error: updateError } = await admin
      .from('scan_sessions')
      .update({
        remote_mode: mode,
        remote_asset_tag: mode === 'damage' ? assetTag : null
      })
      .eq('id', scanSessionId);
    if (updateError) throw updateError;

    return new Response(JSON.stringify({
      ok: true,
      mode,
      asset_tag: mode === 'damage' ? assetTag : null
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
