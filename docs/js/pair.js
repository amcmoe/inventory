import { qs, toast, initTheme, bindThemeToggle } from './ui.js';

const pairStartBtn = qs('#pairStartBtn');
const scanStartBtn = qs('#scanStartBtn');
const scanStopBtn = qs('#scanStopBtn');
const pairState = qs('#pairState');
const pairCountdown = qs('#pairCountdown');
const pairHint = qs('#pairHint');
const stage = qs('#pairScannerStage');
const video = qs('#pairScannerVideo');
const canvas = qs('#pairScannerCanvas');

let stream = null;
let detector = null;
let timer = null;
let mode = 'idle'; // idle | pairing | scanning
let lastRead = '';
let lastReadAt = 0;
let scanSessionId = null;
let sessionExpiresAt = null;
let countdownTimer = null;

function appConfig() {
  return window.APP_CONFIG || {};
}

function updateCountdown() {
  if (!sessionExpiresAt) {
    pairCountdown.textContent = '--:--';
    return;
  }
  const remaining = new Date(sessionExpiresAt).getTime() - Date.now();
  if (remaining <= 0) {
    pairCountdown.textContent = '00:00';
    pairState.textContent = 'Session expired';
    stopCamera();
    scanStartBtn.disabled = true;
    scanStopBtn.disabled = true;
    mode = 'idle';
    return;
  }
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  pairCountdown.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startCountdown() {
  if (countdownTimer) window.clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = window.setInterval(updateCountdown, 500);
}

function parsePairPayload(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const json = JSON.parse(value);
    if (json?.pairing_id && json?.challenge) {
      return { pairing_id: json.pairing_id, challenge: json.challenge };
    }
  } catch {
    // non-json payload
  }
  try {
    const url = new URL(value);
    const pairingId = url.searchParams.get('pairing_id');
    const challenge = url.searchParams.get('challenge');
    if (pairingId && challenge) return { pairing_id: pairingId, challenge };
  } catch {
    // non-url payload
  }
  return null;
}

async function postNoAuth(functionName, body) {
  const cfg = appConfig();
  const response = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: cfg.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `${functionName} failed`);
  }
  return data;
}

function stopCamera() {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (video) video.srcObject = null;
  if (stage) stage.hidden = true;
}

async function startCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  if ('BarcodeDetector' in window) {
    detector = new window.BarcodeDetector({
      formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e']
    });
  } else {
    detector = null;
  }
  stage.hidden = false;
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => scanFrame().catch((err) => toast(err.message, true)), 220);
}

async function consumePairing(pairing) {
  const session = await postNoAuth('pairing-consume', {
    pairing_id: pairing.pairing_id,
    challenge: pairing.challenge
  });
  scanSessionId = session.scan_session_id;
  sessionExpiresAt = session.expires_at;
  pairState.textContent = `Paired (${session.context})`;
  pairHint.textContent = 'Pairing complete. Scan barcodes now.';
  scanStartBtn.disabled = false;
  scanStopBtn.disabled = false;
  mode = 'scanning';
  startCountdown();
  toast('Phone paired.');
}

async function submitScan(barcode) {
  if (!scanSessionId) return;
  await postNoAuth('scan-submit', {
    scan_session_id: scanSessionId,
    barcode
  });
}

async function handleRead(raw) {
  const now = Date.now();
  const text = String(raw || '').trim();
  if (!text) return;
  if (text === lastRead && now - lastReadAt < 1200) return;
  lastRead = text;
  lastReadAt = now;

  if (mode === 'pairing') {
    const pairing = parsePairPayload(text);
    if (!pairing) {
      toast('Not a valid pairing QR.', true);
      return;
    }
    await consumePairing(pairing);
    return;
  }
  if (mode === 'scanning') {
    await submitScan(text);
    toast(`Scanned: ${text}`);
  }
}

async function scanFrame() {
  if (!video || video.readyState < 2) return;
  if (mode === 'idle') return;
  if (detector) {
    const codes = await detector.detect(video);
    if (codes?.length && codes[0].rawValue) {
      await handleRead(codes[0].rawValue);
    }
    return;
  }
  if (!window.jsQR) return;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
  if (code?.data) {
    await handleRead(code.data);
  }
}

async function startPairMode() {
  mode = 'pairing';
  pairState.textContent = 'Waiting for pairing QR...';
  pairHint.textContent = 'Point at the pairing QR shown on desktop.';
  scanStartBtn.disabled = true;
  scanStopBtn.disabled = false;
  await startCamera();
}

async function startScanMode() {
  if (!scanSessionId) {
    toast('Pair first.', true);
    return;
  }
  mode = 'scanning';
  pairState.textContent = 'Scanner active';
  pairHint.textContent = 'Scanning barcodes to desktop session.';
  if (!stream) await startCamera();
}

function stopAll() {
  mode = 'idle';
  stopCamera();
  pairHint.textContent = 'Tap “Scan Pair QR” and point camera at the desktop pairing code.';
}

function init() {
  initTheme();
  bindThemeToggle();
  pairStartBtn?.addEventListener('click', () => {
    startPairMode().catch((err) => toast(err.message, true));
  });
  scanStartBtn?.addEventListener('click', () => {
    startScanMode().catch((err) => toast(err.message, true));
  });
  scanStopBtn?.addEventListener('click', stopAll);
  window.addEventListener('beforeunload', stopCamera);
}

init();
