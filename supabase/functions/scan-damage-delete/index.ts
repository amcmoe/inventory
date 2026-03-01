import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type DeleteBody = {
  scan_session_id?: string | null;
  path?: string;
};

function getScanSessionIdFromPath(path: string): string {
  const parts = String(path || '').split('/').filter(Boolean);
  if (parts.length < 3) return '';
  if (parts[0] !== 'remote-temp') return '';
  return String(parts[1] || '').trim();
}

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

    const body = (await req.json()) as DeleteBody;
    const path = String(body.path || '').trim();
    if (!path) {
      throw new Error('path is required');
    }
    if (!path.startsWith('remote-temp/')) {
      throw new Error('Only remote-temp paths can be deleted');
    }

    const inferredSessionId = getScanSessionIdFromPath(path);
    const scanSessionId = String(body.scan_session_id || inferredSessionId || '').trim();
    if (!scanSessionId) {
      throw new Error('scan_session_id is required');
    }
    if (inferredSessionId && inferredSessionId !== scanSessionId) {
      throw new Error('scan_session_id does not match path');
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: session, error: sessionError } = await admin
      .from('scan_sessions')
      .select('id, created_by_user_id')
      .eq('id', scanSessionId)
      .single();
    if (sessionError || !session) {
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

    const storageResult = await admin.storage
      .from('asset-damage-photos')
      .remove([path]);
    if (storageResult.error) {
      throw storageResult.error;
    }

    const { error: eventDeleteError } = await admin
      .from('scan_events')
      .delete()
      .eq('scan_session_id', scanSessionId)
      .eq('source', 'remote_damage_photo')
      .ilike('barcode', `%${path}%`);
    if (eventDeleteError) {
      throw eventDeleteError;
    }

    return new Response(JSON.stringify({ ok: true, path }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
