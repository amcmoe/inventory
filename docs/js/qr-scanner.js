import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility } from './ui.js';

const scannerTopbar = qs('#scannerTopbar');
const scannerNav = qs('#scannerNav');
const scannerLoadingPanel = qs('#scannerLoadingPanel');
const scannerMainSection = qs('#scannerMainSection');
const scannerResultSection = qs('#scannerResultSection');
const scannerResultBody = qs('#scannerResultBody');

const startBtn = qs('#startScannerBtn');
const stopBtn = qs('#stopScannerBtn');
const video = qs('#scannerVideo');
const canvas = qs('#scannerCanvas');
const lastScanValue = qs('#lastScanValue');
const manualTag = qs('#manualTag');
const manualLookupBtn = qs('#manualLookupBtn');

let stream = null;
let scanTimer = null;
let detector = null;
let lastRaw = '';
let lastScanAt = 0;

function extractCandidates(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];

  const candidates = [raw];
  try {
    const url = new URL(raw);
    const tag = url.searchParams.get('tag');
    if (tag) candidates.push(tag.trim());
    const parts = url.pathname.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1];
    if (lastPart) candidates.push(lastPart.trim());
  } catch {
    // raw text, keep as-is
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function lookupAsset(rawValue) {
  const candidates = extractCandidates(rawValue);
  if (!candidates.length) {
    toast('No readable tag found.', true);
    return false;
  }

  lastScanValue.textContent = candidates[0];

  for (const tag of candidates) {
    const { data, error } = await supabase
      .from('assets')
      .select('asset_tag, model, equipment_type, status, building, room')
      .eq('asset_tag', tag)
      .maybeSingle();

    if (error) {
      toast(error.message, true);
      return false;
    }

    if (data) {
      const buildingParts = [data.building, data.room].filter(Boolean);
      scannerResultBody.innerHTML = `
        <div class="detail-grid">
          <div class="detail"><div class="k">Asset Tag</div><div class="v mono">${escapeHtml(data.asset_tag)}</div></div>
          <div class="detail"><div class="k">Model</div><div class="v">${escapeHtml(data.model || '-')}</div></div>
          <div class="detail"><div class="k">Type</div><div class="v">${escapeHtml(data.equipment_type || '-')}</div></div>
          <div class="detail"><div class="k">Status</div><div class="v">${escapeHtml(data.status || '-')}</div></div>
          <div class="detail"><div class="k">Building / Room</div><div class="v">${escapeHtml(buildingParts.join(' / ') || '-')}</div></div>
        </div>
        <div class="row">
          <a class="btn primary" href="./asset.html?tag=${encodeURIComponent(data.asset_tag)}">Open Asset</a>
        </div>
      `;
      scannerResultSection.hidden = false;
      toast('Asset found.');
      return true;
    }
  }

  scannerResultBody.innerHTML = `<div class="detail"><div class="k">Result</div><div class="v">No asset found for scanned value.</div></div>`;
  scannerResultSection.hidden = false;
  toast('No matching asset found.', true);
  return false;
}

async function handleScan(rawValue) {
  const now = Date.now();
  if (!rawValue || (rawValue === lastRaw && now - lastScanAt < 2000)) {
    return;
  }
  lastRaw = rawValue;
  lastScanAt = now;
  const found = await lookupAsset(rawValue);
  if (found) {
    stopScanner();
  }
}

async function scanFrame() {
  if (!video || video.readyState < 2) {
    return;
  }

  if (detector) {
    const codes = await detector.detect(video);
    if (codes?.length && codes[0].rawValue) {
      await handleScan(codes[0].rawValue);
      return;
    }
  } else if (window.jsQR) {
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
    if (code?.data) {
      await handleScan(code.data);
      return;
    }
  }
}

function stopScanner() {
  if (scanTimer) {
    window.clearInterval(scanTimer);
    scanTimer = null;
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (video) {
    video.srcObject = null;
  }
  stopBtn.disabled = true;
  startBtn.disabled = false;
}

async function startScanner() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();

    if ('BarcodeDetector' in window) {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } else {
      detector = null;
    }

    if (scanTimer) window.clearInterval(scanTimer);
    scanTimer = window.setInterval(() => {
      scanFrame().catch((err) => toast(err.message, true));
    }, 250);

    stopBtn.disabled = false;
    startBtn.disabled = true;
  } catch (err) {
    toast(`Camera start failed: ${err.message}`, true);
  }
}

async function init() {
  if (!requireConfig()) {
    toast('Update config.js with Supabase config.', true);
    return;
  }

  const session = await getSession();
  if (!requireAuth(session)) {
    return;
  }

  const profile = await getCurrentProfile();
  setRoleVisibility(profile.role);

  scannerLoadingPanel.hidden = true;
  scannerTopbar.hidden = false;
  scannerNav.hidden = false;
  scannerMainSection.hidden = false;

  startBtn.addEventListener('click', startScanner);
  stopBtn.addEventListener('click', stopScanner);
  manualLookupBtn.addEventListener('click', async () => {
    const value = manualTag.value.trim();
    if (!value) {
      toast('Enter serial/tag first.', true);
      return;
    }
    await lookupAsset(value);
  });

  window.addEventListener('beforeunload', stopScanner);
}

init().catch((err) => toast(err.message, true));
