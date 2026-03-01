import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type DamagePhotoBody = {
  scan_session_id?: string;
  pairing_id?: string;
  challenge?: string;
  asset_tag?: string | null;
  image_base64?: string;
  mime_type?: string;
};

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = (await req.json()) as DamagePhotoBody;
    const scanSessionId = String(body.scan_session_id || '').trim();
    const pairingId = String(body.pairing_id || '').trim();
    const challenge = String(body.challenge || '').trim();
    const assetTag = String(body.asset_tag || '').trim() || null;
    const imageBase64 = String(body.image_base64 || '').trim();
    const mimeType = String(body.mime_type || 'image/jpeg').trim().toLowerCase();

    if (!scanSessionId || !pairingId || !challenge || !imageBase64) {
      throw new Error('scan_session_id, pairing_id, challenge, and image_base64 are required');
    }
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(mimeType)) {
      throw new Error('Unsupported image type');
    }

    const { data: session, error: sessionError } = await admin
      .from('scan_sessions')
      .select('id, status, expires_at, pairing_challenge_id')
      .eq('id', scanSessionId)
      .single();
    if (sessionError || !session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
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

    const { data: pairing, error: pairingError } = await admin
      .from('pairing_challenges')
      .select('id, challenge, consumed_at')
      .eq('id', pairingId)
      .eq('challenge', challenge)
      .single();
    if (
      pairingError ||
      !pairing ||
      pairing.id !== session.pairing_challenge_id ||
      !pairing.consumed_at
    ) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const bytes = base64ToBytes(imageBase64);
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Image exceeds 5MB limit' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const path = `remote-temp/${scanSessionId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const upload = await admin.storage
      .from('asset-damage-photos')
      .upload(path, bytes, {
        contentType: mimeType,
        upsert: false
      });
    if (upload.error) throw upload.error;

    const payload = JSON.stringify({
      type: 'damage_photo',
      path,
      asset_tag: assetTag
    });
    const { error: eventError } = await admin
      .from('scan_events')
      .insert({
        scan_session_id: scanSessionId,
        barcode: payload,
        source: 'remote_damage_photo'
      });
    if (eventError) throw eventError;

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
