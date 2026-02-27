import { qs, toast, initTheme, bindThemeToggle } from './ui.js';

const pairStartBtn = qs('#pairStartBtn');
const scanStartBtn = qs('#scanStartBtn');
const scanPauseBtn = qs('#scanPauseBtn');
const scanEndSessionBtn = qs('#scanEndSessionBtn');
const pairState = qs('#pairState');
const pairCountdown = qs('#pairCountdown');
const pairHint = qs('#pairHint');
const stage = qs('#pairScannerStage');
const video = qs('#pairScannerVideo');
const freezeCanvas = qs('#pairScannerFreeze');
const overlayCanvas = qs('#pairScannerOverlay');
const canvas = qs('#pairScannerCanvas');

let stream = null;
let detector = null;
let timer = null;
let mode = 'idle'; // idle | pairing | scanning | paused
let lastRead = '';
let lastReadAt = 0;
let scanSessionId = null;
let sessionExpiresAt = null;
let countdownTimer = null;
let activePairingId = null;
let activePairingChallenge = null;
let audioCtx = null;
let freezeUntil = 0;
let freezeTimer = null;

function appConfig() {
  return window.APP_CONFIG || {};
}

function updateScanButtons() {
  const hasSession = Boolean(scanSessionId);
  const cameraOpen = !stage.hidden;
  scanStartBtn.hidden = !(hasSession && !cameraOpen);
  scanStartBtn.disabled = !hasSession;
  scanPauseBtn.hidden = !cameraOpen;
  scanPauseBtn.disabled = !cameraOpen;
  scanEndSessionBtn.disabled = !hasSession;
}

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

function playScanChime() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  gain.connect(audioCtx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

  const oscA = audioCtx.createOscillator();
  oscA.type = 'sine';
  oscA.frequency.setValueAtTime(820, now);
  oscA.frequency.exponentialRampToValueAtTime(1046, now + 0.12);
  oscA.connect(gain);
  oscA.start(now);
  oscA.stop(now + 0.14);

  const oscB = audioCtx.createOscillator();
  oscB.type = 'sine';
  oscB.frequency.setValueAtTime(1244, now + 0.1);
  oscB.connect(gain);
  oscB.start(now + 0.1);
  oscB.stop(now + 0.22);
}

function clearOverlay() {
  if (!overlayCanvas) return;
  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function clearFreeze() {
  if (!freezeCanvas) return;
  freezeCanvas.hidden = true;
  const ctx = freezeCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, freezeCanvas.width, freezeCanvas.height);
}

function toPolygonArray(points) {
  if (!Array.isArray(points) || points.length < 4) return [];
  return points.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 }));
}

function detectLabelCandidateFromFrame(imageData, width, height) {
  if (!imageData?.data || !width || !height) return null;
  const step = 4;
  const data = imageData.data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let brightCount = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luma = (r * 0.299) + (g * 0.587) + (b * 0.114);
      const sat = max - min;
      if (luma > 205 && sat < 28) {
        brightCount += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!brightCount) return null;
  const sampledTotal = Math.ceil(width / step) * Math.ceil(height / step);
  const ratio = brightCount / sampledTotal;
  if (ratio < 0.02 || ratio > 0.45) return null;
  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (boxW < width * 0.15 || boxH < height * 0.1) return null;
  const aspect = boxW / Math.max(1, boxH);
  if (aspect < 1.2 || aspect > 4.8) return null;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}

function drawOverlay(polygons, color = '#22c55e') {
  if (!overlayCanvas || !stage || !video) return;
  const displayW = stage.clientWidth;
  const displayH = stage.clientHeight;
  if (!displayW || !displayH) return;

  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(displayW * dpr);
  const targetH = Math.round(displayH * dpr);
  if (overlayCanvas.width !== targetW || overlayCanvas.height !== targetH) {
    overlayCanvas.width = targetW;
    overlayCanvas.height = targetH;
  }
  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayW, displayH);
  if (!polygons?.length) return;

  const videoW = video.videoWidth || 640;
  const videoH = video.videoHeight || 480;
  const scale = Math.max(displayW / videoW, displayH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const offsetX = (displayW - drawW) / 2;
  const offsetY = (displayH - drawH) / 2;

  const isWarn = color === '#facc15';
  ctx.strokeStyle = color;
  ctx.shadowColor = isWarn ? 'rgba(250,204,21,0.45)' : 'rgba(34,197,94,0.55)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 4;

  polygons.forEach((poly) => {
    if (!poly || poly.length < 2) return;
    ctx.beginPath();
    poly.forEach((pt, i) => {
      const x = (pt.x * scale) + offsetX;
      const y = (pt.y * scale) + offsetY;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  });
}

function showFreezeFrame(readText = '', durationMs = 1000) {
  if (!freezeCanvas || !video || !stage) return;
  const displayW = stage.clientWidth;
  const displayH = stage.clientHeight;
  if (!displayW || !displayH) return;

  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(displayW * dpr);
  const targetH = Math.round(displayH * dpr);
  if (freezeCanvas.width !== targetW || freezeCanvas.height !== targetH) {
    freezeCanvas.width = targetW;
    freezeCanvas.height = targetH;
  }
  const ctx = freezeCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayW, displayH);

  const videoW = video.videoWidth || 640;
  const videoH = video.videoHeight || 480;
  const scale = Math.max(displayW / videoW, displayH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const offsetX = (displayW - drawW) / 2;
  const offsetY = (displayH - drawH) / 2;

  ctx.drawImage(video, offsetX, offsetY, drawW, drawH);
  if (readText) {
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    const label = `Read: ${readText}`;
    const textW = ctx.measureText(label).width;
    const boxW = Math.min(displayW - 20, textW + 20);
    const boxH = 30;
    const boxX = 10;
    const boxY = displayH - boxH - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, boxX + 10, boxY + 20);
  }
  freezeCanvas.hidden = false;
  freezeUntil = Date.now() + durationMs;
  if (freezeTimer) window.clearTimeout(freezeTimer);
  freezeTimer = window.setTimeout(() => {
    freezeTimer = null;
    clearFreeze();
  }, durationMs);
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
    scanPauseBtn.disabled = true;
    scanEndSessionBtn.disabled = true;
    mode = 'idle';
    updateScanButtons();
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
    if (json?.pairing_id && json?.challenge) return { pairing_id: json.pairing_id, challenge: json.challenge };
  } catch {}
  try {
    const url = new URL(value);
    const pairingId = url.searchParams.get('pairing_id');
    const challenge = url.searchParams.get('challenge');
    if (pairingId && challenge) return { pairing_id: pairingId, challenge };
  } catch {}
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
  if (!response.ok) throw new Error(data?.error || `${functionName} failed`);
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
  clearOverlay();
  clearFreeze();
  freezeUntil = 0;
  updateScanButtons();
}

async function startCamera() {
  ensureAudioContext();
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
  updateScanButtons();
  if (timer) window.clearInterval(timer);
  timer = window.setInterval(() => scanFrame().catch((err) => toast(err.message, true)), 220);
}

async function consumePairing(pairing) {
  const session = await postNoAuth('pairing-consume', {
    pairing_id: pairing.pairing_id,
    challenge: pairing.challenge
  });
  activePairingId = pairing.pairing_id;
  activePairingChallenge = pairing.challenge;
  scanSessionId = session.scan_session_id;
  sessionExpiresAt = session.expires_at;
  pairState.textContent = `Paired (${session.context})`;
  pairHint.textContent = 'Pairing complete. Scanning is active.';
  if (!stream) await startCamera();
  mode = 'scanning';
  startCountdown();
  updateScanButtons();
  toast('Phone paired.');
}

async function submitScan(barcode) {
  if (!scanSessionId) return;
  await postNoAuth('scan-submit', { scan_session_id: scanSessionId, barcode });
}

async function handleRead(raw) {
  const now = Date.now();
  const text = String(raw || '').trim();
  if (!text) return;
  if (text === lastRead && now - lastReadAt < 1200) return;
  lastRead = text;
  lastReadAt = now;
  showFreezeFrame(text, 1000);
  playScanChime();

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
  if (Date.now() < freezeUntil) return;

  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  if (detector) {
    const codes = await detector.detect(video);
    const polygons = (codes || [])
      .map((code) => toPolygonArray(code.cornerPoints))
      .filter((points) => Array.isArray(points) && points.length >= 4);

    if (polygons.length) drawOverlay(polygons, '#22c55e');
    else {
      const candidate = detectLabelCandidateFromFrame(imageData, width, height);
      if (candidate) drawOverlay([candidate], '#facc15');
      else clearOverlay();
    }
    if (codes?.length && codes[0].rawValue) {
      await handleRead(codes[0].rawValue);
    }
    return;
  }

  if (!window.jsQR) return;
  const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
  if (code?.data) {
    const loc = code.location;
    if (loc) {
      const poly = toPolygonArray([loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner]);
      if (poly?.length) drawOverlay([poly], '#22c55e');
    } else {
      clearOverlay();
    }
    await handleRead(code.data);
  } else {
    const candidate = detectLabelCandidateFromFrame(imageData, width, height);
    if (candidate) drawOverlay([candidate], '#facc15');
    else clearOverlay();
  }
}

async function startPairMode() {
  mode = 'pairing';
  pairState.textContent = 'Waiting for pairing QR...';
  pairHint.textContent = 'Point at the pairing QR shown on desktop.';
  await startCamera();
  updateScanButtons();
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
  updateScanButtons();
}

function pauseScanning() {
  if (!scanSessionId) return;
  mode = 'paused';
  stopCamera();
  pairHint.textContent = 'Scanning paused. Tap Start Scanning to resume.';
  updateScanButtons();
}

function stopAll() {
  mode = 'idle';
  stopCamera();
  pairHint.textContent = 'Tap "Scan Pair QR" and point camera at the desktop pairing code.';
  updateScanButtons();
}

async function endSessionFromPhone() {
  if (!scanSessionId) {
    toast('No active session.', true);
    return;
  }
  const cfg = appConfig();
  const response = await fetch(`${cfg.SUPABASE_URL}/functions/v1/scan-session-end`, {
    method: 'POST',
    headers: {
      apikey: cfg.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      scan_session_id: scanSessionId,
      pairing_id: activePairingId,
      challenge: activePairingChallenge
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Failed to end session');

  scanSessionId = null;
  sessionExpiresAt = null;
  activePairingId = null;
  activePairingChallenge = null;
  scanStartBtn.disabled = true;
  scanPauseBtn.disabled = true;
  scanEndSessionBtn.disabled = true;
  pairState.textContent = 'Session ended';
  pairCountdown.textContent = '--:--';
  stopAll();
  updateScanButtons();
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
  scanPauseBtn?.addEventListener('click', pauseScanning);
  scanEndSessionBtn?.addEventListener('click', () => {
    endSessionFromPhone().catch((err) => toast(err.message, true));
  });
  window.addEventListener('beforeunload', stopCamera);
  updateScanButtons();
}

init();
