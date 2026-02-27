import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type ScanSubmitBody = {
  scan_session_id?: string;
  barcode?: string;
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

    const body = (await req.json()) as ScanSubmitBody;
    const scanSessionId = body.scan_session_id?.trim();
    const barcode = body.barcode?.trim();
    if (!scanSessionId || !barcode) {
      throw new Error('scan_session_id and barcode are required');
    }

    const { data: session, error: sessionError } = await admin
      .from('scan_sessions')
      .select('id, status, expires_at')
      .eq('id', scanSessionId)
      .single();
    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const now = Date.now();
    const exp = new Date(session.expires_at).getTime();
    if (session.status !== 'active' || Number.isNaN(exp) || exp <= now) {
      if (session.status === 'active' && exp <= now) {
        await admin.from('scan_sessions')
          .update({ status: 'expired', ended_at: new Date().toISOString() })
          .eq('id', scanSessionId);
      }
      return new Response(JSON.stringify({ error: 'Session is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: eventRow, error: insertError } = await admin
      .from('scan_events')
      .insert({
        scan_session_id: scanSessionId,
        barcode,
        source: 'remote_phone'
      })
      .select('id, created_at')
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({
      ok: true,
      event_id: eventRow.id,
      created_at: eventRow.created_at
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

