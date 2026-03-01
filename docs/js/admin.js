import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh, startSessionKeepAlive } from './auth.js';
import { qs, toast, initTheme, bindThemeToggle, bindSignOut, initAdminNav } from './ui.js';

const adminLoadingPanel = qs('#adminLoadingPanel');
const adminTopbar = qs('#adminTopbar');
const assetAdminSection = qs('#assetAdminSection');
const bulkCreateSection = qs('#bulkCreateSection');
const adminNav = qs('#adminNav');
const editOnlyFields = document.querySelectorAll('[data-edit-only]');
const bulkScannerToggleBtn = qs('#bulkScannerToggleBtn');
const bulkRemoteScanBtn = qs('#bulkRemoteScanBtn');
const bulkScannerStage = qs('#bulkScannerStage');
const bulkScannerVideo = qs('#bulkScannerVideo');
const bulkScannerFreeze = qs('#bulkScannerFreeze');
const bulkScannerOverlay = qs('#bulkScannerOverlay');
const bulkScannerCanvas = qs('#bulkScannerCanvas');
const bulkSerialCount = qs('#bulkSerialCount');
const bulkSerialsField = qs('#bulkSerials');
const bulkScanSoundBtn = qs('#bulkScanSoundBtn');
const bulkClearConfirm = qs('#bulkClearConfirm');
const confirmClearBulkYes = qs('#confirmClearBulkYes');
const confirmClearBulkNo = qs('#confirmClearBulkNo');
const pairModalOverlay = qs('#pairModalOverlay');
const pairModal = qs('#pairModal');
const pairModalCloseBtn = qs('#pairModalCloseBtn');
const pairQrCanvas = qs('#pairQrCanvas');
const pairStatus = qs('#pairStatus');
const pairMeta = qs('#pairMeta');
const pairRegenerateBtn = qs('#pairRegenerateBtn');
const pairEndSessionBtn = qs('#pairEndSessionBtn');
const remoteBadge = qs('#remoteBadge');

const knownManufacturers = ['Apple', 'Dell', 'Lenovo', 'HP', 'Beelink'];
let bulkScannerStream = null;
let bulkScannerTimer = null;
let bulkScannerDetector = null;
let lastBulkScan = '';
let lastBulkScanAt = 0;
let bulkScannerFullscreen = false;
let bulkFreezeUntil = 0;
let bulkFreezeTimer = null;
let bulkAudioCtx = null;
let bulkScannerRunning = false;
let bulkScanSoundEnabled = true;
let remotePairingId = null;
let remoteSessionId = null;
let remoteSessionExpiresAt = null;
let pairingGenerateInFlight = false;
let remotePairPollTimer = null;
let remoteExpireTimer = null;
let remoteChannel = null;
let remoteStatusTimer = null;
const REMOTE_SESSION_KEY = 'remoteScanSession';
let stopSessionKeepAlive = null;

function syncBulkScannerToggleLabel() {
  if (!bulkScannerToggleBtn) return;
  bulkScannerToggleBtn.classList.toggle('is-running', bulkScannerRunning);
  bulkScannerToggleBtn.setAttribute('aria-label', bulkScannerRunning ? 'Stop scanner' : 'Start scanner');
  bulkScannerToggleBtn.title = bulkScannerRunning ? 'Stop' : 'QR Scanner';
}

function syncBulkSoundButton() {
  if (!bulkScanSoundBtn) return;
  bulkScanSoundBtn.classList.toggle('is-muted', !bulkScanSoundEnabled);
  bulkScanSoundBtn.setAttribute('aria-pressed', bulkScanSoundEnabled ? 'true' : 'false');
  bulkScanSoundBtn.setAttribute('aria-label', bulkScanSoundEnabled ? 'Scan sound on' : 'Scan sound off');
  bulkScanSoundBtn.title = bulkScanSoundEnabled ? 'Scan Sound: On' : 'Scan Sound: Off';
}

function syncBulkScannerHeight() {
  if (!bulkSerialsField || !bulkScannerStage || bulkScannerStage.hidden) return;
  const targetHeight = Math.max(220, Math.round(bulkSerialsField.getBoundingClientRect().height));
  bulkScannerStage.style.height = `${targetHeight}px`;
}

function clearBulkOverlay() {
  if (!bulkScannerOverlay) return;
  const ctx = bulkScannerOverlay.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, bulkScannerOverlay.width, bulkScannerOverlay.height);
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

function clearBulkFreezeFrame() {
  if (!bulkScannerFreeze) return;
  bulkScannerFreeze.hidden = true;
  const ctx = bulkScannerFreeze.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, bulkScannerFreeze.width, bulkScannerFreeze.height);
}

function ensureBulkAudioContext() {
  if (!bulkAudioCtx) {
    bulkAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (bulkAudioCtx.state === 'suspended') {
    bulkAudioCtx.resume().catch(() => {});
  }
}

function playScanChime() {
  if (!bulkScanSoundEnabled) return;
  if (!bulkAudioCtx) return;
  const now = bulkAudioCtx.currentTime;
  const gain = bulkAudioCtx.createGain();
  gain.connect(bulkAudioCtx.destination);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

  const oscA = bulkAudioCtx.createOscillator();
  oscA.type = 'sine';
  oscA.frequency.setValueAtTime(880, now);
  oscA.frequency.exponentialRampToValueAtTime(1046, now + 0.12);
  oscA.connect(gain);
  oscA.start(now);
  oscA.stop(now + 0.14);

  const oscB = bulkAudioCtx.createOscillator();
  oscB.type = 'sine';
  oscB.frequency.setValueAtTime(1318, now + 0.1);
  oscB.connect(gain);
  oscB.start(now + 0.1);
  oscB.stop(now + 0.24);
}

function showBulkFreezeFrame(durationMs = 1200, readText = '', successPoly = null) {
  if (!bulkScannerVideo || !bulkScannerFreeze || !bulkScannerStage) return;
  const displayW = bulkScannerStage.clientWidth;
  const displayH = bulkScannerStage.clientHeight;
  if (!displayW || !displayH) return;

  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(displayW * dpr);
  const targetH = Math.round(displayH * dpr);
  if (bulkScannerFreeze.width !== targetW || bulkScannerFreeze.height !== targetH) {
    bulkScannerFreeze.width = targetW;
    bulkScannerFreeze.height = targetH;
  }

  const ctx = bulkScannerFreeze.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayW, displayH);

  const videoW = bulkScannerVideo.videoWidth || 640;
  const videoH = bulkScannerVideo.videoHeight || 480;
  const scale = Math.max(displayW / videoW, displayH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const offsetX = (displayW - drawW) / 2;
  const offsetY = (displayH - drawH) / 2;

  ctx.drawImage(bulkScannerVideo, offsetX, offsetY, drawW, drawH);
  if (Array.isArray(successPoly) && successPoly.length >= 4) {
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 4;
    ctx.shadowColor = 'rgba(34,197,94,0.6)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    successPoly.forEach((pt, idx) => {
      const x = (pt.x * scale) + offsetX;
      const y = (pt.y * scale) + offsetY;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (readText) {
    const text = `Read: ${readText}`;
    ctx.font = '600 16px ui-sans-serif, system-ui, sans-serif';
    const textWidth = ctx.measureText(text).width;
    const padX = 10;
    const boxW = Math.min(displayW - 20, textWidth + (padX * 2));
    const boxH = 30;
    const boxX = 10;
    const boxY = displayH - boxH - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, boxX + padX, boxY + 20);
  }
  bulkScannerFreeze.hidden = false;
  bulkFreezeUntil = Date.now() + durationMs;
  if (bulkFreezeTimer) {
    window.clearTimeout(bulkFreezeTimer);
  }
  bulkFreezeTimer = window.setTimeout(() => {
    bulkFreezeTimer = null;
    clearBulkFreezeFrame();
  }, durationMs);
}

function drawBulkOverlay(polygons, color = '#22c55e') {
  if (!bulkScannerOverlay || !bulkScannerStage || !bulkScannerVideo) return;
  const displayW = bulkScannerStage.clientWidth;
  const displayH = bulkScannerStage.clientHeight;
  if (!displayW || !displayH) return;

  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(displayW * dpr);
  const targetH = Math.round(displayH * dpr);
  if (bulkScannerOverlay.width !== targetW || bulkScannerOverlay.height !== targetH) {
    bulkScannerOverlay.width = targetW;
    bulkScannerOverlay.height = targetH;
  }

  const ctx = bulkScannerOverlay.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayW, displayH);

  if (!polygons?.length) return;

  const videoW = bulkScannerVideo.videoWidth || 640;
  const videoH = bulkScannerVideo.videoHeight || 480;
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
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.stroke();
  });
}

async function animateScanToTextarea(serial) {
  if (!bulkScannerStage || !bulkSerialsField || !serial) return;
  const stageRect = bulkScannerStage.getBoundingClientRect();
  const fieldRect = bulkSerialsField.getBoundingClientRect();
  if (!stageRect.width || !fieldRect.width) return;

  const chip = document.createElement('div');
  chip.className = 'scan-float-chip';
  chip.textContent = serial;
  document.body.appendChild(chip);
  const chipRect = chip.getBoundingClientRect();

  const startX = stageRect.left + ((stageRect.width - chipRect.width) / 2);
  const startY = stageRect.top + ((stageRect.height - chipRect.height) / 2);
  const endX = fieldRect.left + ((fieldRect.width - chipRect.width) / 2);
  const endY = fieldRect.top + ((fieldRect.height - chipRect.height) / 2);

  chip.style.left = `${startX}px`;
  chip.style.top = `${startY}px`;
  chip.style.opacity = '0';

  await chip.animate(
    [
      { transform: 'translate(0, 0) scale(0.92)', opacity: 0 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0.24 },
      { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(0.97)`, opacity: 1, offset: 0.88 },
      { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(0.9)`, opacity: 0 }
    ],
    { duration: 1280, easing: 'cubic-bezier(.2,.74,.18,1)', fill: 'forwards' }
  ).finished.catch(() => {});

  chip.remove();
}

function currentManufacturerValue() {
  const selected = qs('#manufacturer').value;
  if (selected === '__custom__') {
    return qs('#manufacturerCustom').value.trim() || null;
  }
  return selected || null;
}

function syncManufacturerInput() {
  const showCustom = qs('#manufacturer').value === '__custom__';
  qs('#manufacturerCustom').hidden = !showCustom;
}

function setManufacturerValue(value) {
  if (!value) {
    qs('#manufacturer').value = '';
    qs('#manufacturerCustom').value = '';
    qs('#manufacturerCustom').hidden = true;
    return;
  }
  if (knownManufacturers.includes(value)) {
    qs('#manufacturer').value = value;
    qs('#manufacturerCustom').value = '';
    qs('#manufacturerCustom').hidden = true;
    return;
  }
  qs('#manufacturer').value = '__custom__';
  qs('#manufacturerCustom').value = value;
  qs('#manufacturerCustom').hidden = false;
}

function setEditMode(isEditMode) {
  editOnlyFields.forEach((node) => {
    node.hidden = !isEditMode;
  });
}

function sanitizeLookupTerm(term) {
  return String(term || '')
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFormValues() {
  const assetTag = qs('#assetTag').value.trim() || null;
  const model = qs('#model').value.trim() || null;
  const derivedDeviceName = model || assetTag;
  return {
    p_id: qs('#assetId').value.trim() || null,
    p_asset_tag: assetTag,
    p_serial: assetTag,
    p_equipment: null,
    p_device_name: derivedDeviceName,
    p_manufacturer: currentManufacturerValue(),
    p_model: model,
    p_equipment_type: qs('#equipmentType').value.trim() || null,
    p_location: null,
    p_building: qs('#building').value.trim() || null,
    p_room: qs('#room').value.trim() || null,
    p_service_start_date: qs('#serviceStartDate').value || null,
    p_asset_condition: null,
    p_comments: qs('#comments').value.trim() || null,
    p_ownership: qs('#ownership').value || null,
    p_warranty_expiration_date: qs('#warrantyExpirationDate').value || null,
    p_obsolete: qs('#obsolete').value === 'true',
    p_status: qs('#status').value,
    p_notes: null
  };
}

function setForm(asset) {
  const editableStatus = ['available', 'repair', 'retired'].includes(asset.status)
    ? asset.status
    : 'available';
  qs('#assetId').value = asset.id || '';
  qs('#assetTag').value = asset.asset_tag || '';
  setManufacturerValue(asset.manufacturer || '');
  qs('#model').value = asset.model || '';
  qs('#equipmentType').value = asset.equipment_type || '';
  qs('#building').value = asset.building || '';
  qs('#room').value = asset.room || '';
  qs('#serviceStartDate').value = asset.service_start_date || '';
  qs('#comments').value = asset.comments || '';
  qs('#ownership').value = asset.ownership || '';
  qs('#warrantyExpirationDate').value = asset.warranty_expiration_date || '';
  qs('#obsolete').value = asset.obsolete ? 'true' : 'false';
  qs('#status').value = editableStatus;
  setEditMode(Boolean(asset.id));
}

async function saveAsset() {
  const payload = getFormValues();
  const isEdit = Boolean(payload.p_id);

  const { data, error } = await supabase.rpc('admin_upsert_asset', payload);
  if (error) {
    toast(error.message, true);
    return;
  }

  setForm(data);
  toast(isEdit ? 'Asset updated.' : 'Asset created.');
}

async function loadByTag() {
  const term = sanitizeLookupTerm(qs('#assetTag').value);
  if (!term) {
    toast('Enter search text.', true);
    return;
  }

  const { data, error } = await supabase
    .from('assets')
    .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, location, building, room, service_start_date, asset_condition, comments, ownership, warranty_expiration_date, obsolete, status, notes')
    .or(`asset_tag.ilike.%${term}%,serial.ilike.%${term}%,device_name.ilike.%${term}%,manufacturer.ilike.%${term}%,model.ilike.%${term}%,equipment_type.ilike.%${term}%,building.ilike.%${term}%,room.ilike.%${term}%`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    toast(error.message, true);
    return;
  }

  if (!data) {
    toast('Asset not found for that search term.', true);
    setEditMode(false);
    return;
  }

  setForm(data);
  if (data.status === 'checked_out') {
    toast('Checked-out status is managed by checkout/checkin RPC only.');
  }
}

async function bulkCreateAssets() {
  const lines = (qs('#bulkSerials').value || '')
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);

  if (!lines.length) {
    toast('Paste at least one serial number.', true);
    return;
  }

  const serials = [...new Set(lines)];
  const base = getFormValues();

  if (!base.p_model) {
    toast('Model is required for bulk create.', true);
    return;
  }
  if (!base.p_equipment_type) {
    toast('Equipment Type is required for bulk create.', true);
    return;
  }

  let success = 0;
  const errors = [];

  const BATCH_SIZE = 10;
  for (let i = 0; i < serials.length; i += BATCH_SIZE) {
    const batch = serials.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (serial) => {
      const payload = {
        ...base,
        p_id: null,
        p_asset_tag: serial,
        p_serial: serial,
        p_device_name: base.p_model || serial,
        p_status: 'available',
        p_obsolete: false,
        p_comments: null
      };
      const { error } = await supabase.rpc('admin_upsert_asset', payload);
      return { serial, error };
    }));

    results.forEach(({ serial, error }) => {
      if (error) errors.push(`${serial}: ${error.message}`);
      else success += 1;
    });
  }

  if (errors.length) {
    console.error('Bulk create errors:', errors);
    toast(`Created ${success}/${serials.length}. Check console for errors.`, true);
  } else {
    toast(`Created ${success} assets.`);
  }
}

function appendBulkSerial(value) {
  const serial = String(value || '').trim();
  if (!serial) return;
  const current = (qs('#bulkSerials').value || '')
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
  if (current.includes(serial)) {
    return false;
  }
  current.push(serial);
  const field = qs('#bulkSerials');
  field.value = `${current.join('\n')}\n`;
  field.scrollTop = field.scrollHeight;
  field.selectionStart = field.value.length;
  field.selectionEnd = field.value.length;
  updateBulkSerialCount();
  toast(`Scanned ${serial}`);
  return true;
}

function updateBulkSerialCount() {
  const total = (qs('#bulkSerials').value || '')
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean).length;
  if (bulkSerialCount) {
    bulkSerialCount.textContent = String(total);
  }
}

function hideBulkClearConfirm() {
  if (bulkClearConfirm) bulkClearConfirm.hidden = true;
}

function showBulkClearConfirm() {
  if (bulkClearConfirm) bulkClearConfirm.hidden = false;
}

function extractScannedSerial(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return (url.searchParams.get('tag') || raw).trim();
  } catch {
    return raw;
  }
}

async function handleBulkScan(rawValue, successPoly = null) {
  const now = Date.now();
  if (!rawValue || (rawValue === lastBulkScan && now - lastBulkScanAt < 1500)) {
    return;
  }
  lastBulkScan = rawValue;
  lastBulkScanAt = now;
  const serial = extractScannedSerial(rawValue);
  showBulkFreezeFrame(1200, serial, successPoly);
  playScanChime();
  await animateScanToTextarea(serial);
  appendBulkSerial(serial);
}

async function tryEnterLandscapeScannerMode() {
  document.body.classList.add('bulk-scan-active');
  if (!window.matchMedia('(max-width: 980px)').matches) {
    return;
  }

  if (screen.orientation?.lock) {
    try {
      await screen.orientation.lock('landscape');
      return;
    } catch {
      // Continue with fullscreen fallback below.
    }
  }

  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    try {
      await document.documentElement.requestFullscreen();
      bulkScannerFullscreen = true;
      if (screen.orientation?.lock) {
        try {
          await screen.orientation.lock('landscape');
        } catch {
          toast('Rotate device to landscape for split scan view.');
        }
      } else {
        toast('Rotate device to landscape for split scan view.');
      }
    } catch {
      toast('Rotate device to landscape for split scan view.');
    }
  } else if (!window.matchMedia('(orientation: landscape)').matches) {
    toast('Rotate device to landscape for split scan view.');
  }
}

async function exitLandscapeScannerMode() {
  document.body.classList.remove('bulk-scan-active');
  if (screen.orientation?.unlock) {
    try {
      screen.orientation.unlock();
    } catch {
      // noop
    }
  }
  if (bulkScannerFullscreen && document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // noop
    }
  }
  bulkScannerFullscreen = false;
}

async function bulkScanFrame() {
  if (!bulkScannerVideo || bulkScannerVideo.readyState < 2) return;
  if (Date.now() < bulkFreezeUntil) return;
  syncBulkScannerHeight();

  const width = bulkScannerVideo.videoWidth || 640;
  const height = bulkScannerVideo.videoHeight || 480;
  bulkScannerCanvas.width = width;
  bulkScannerCanvas.height = height;
  const ctx = bulkScannerCanvas.getContext('2d');
  ctx.drawImage(bulkScannerVideo, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  if (bulkScannerDetector) {
    const codes = await bulkScannerDetector.detect(bulkScannerVideo);
    const polygons = (codes || [])
      .map((code) => toPolygonArray(code.cornerPoints))
      .filter((points) => Array.isArray(points) && points.length >= 4);
    if (polygons.length) {
      drawBulkOverlay(polygons, '#22c55e');
    } else {
      const candidate = detectLabelCandidateFromFrame(imageData, width, height);
      if (candidate) drawBulkOverlay([candidate], '#facc15');
      else clearBulkOverlay();
    }
    if (codes?.length && codes[0].rawValue) {
      await handleBulkScan(codes[0].rawValue, polygons[0] || null);
    }
    return;
  }

  if (!window.jsQR) return;
  const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
  if (code?.data) {
    const loc = code.location;
    let poly = null;
    if (loc) {
      poly = toPolygonArray([loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner]);
      drawBulkOverlay([poly], '#22c55e');
    } else {
      clearBulkOverlay();
    }
    await handleBulkScan(code.data, poly);
  } else {
    const candidate = detectLabelCandidateFromFrame(imageData, width, height);
    if (candidate) drawBulkOverlay([candidate], '#facc15');
    else clearBulkOverlay();
  }
}

function stopBulkScanner() {
  if (bulkScannerTimer) {
    window.clearInterval(bulkScannerTimer);
    bulkScannerTimer = null;
  }
  if (bulkScannerStream) {
    bulkScannerStream.getTracks().forEach((t) => t.stop());
    bulkScannerStream = null;
  }
  if (bulkScannerVideo) bulkScannerVideo.srcObject = null;
  if (bulkScannerStage) bulkScannerStage.style.height = '';
  if (bulkScannerStage) bulkScannerStage.hidden = true;
  bulkScannerRunning = false;
  syncBulkScannerToggleLabel();
  clearBulkOverlay();
  clearBulkFreezeFrame();
  bulkFreezeUntil = 0;
  if (bulkFreezeTimer) {
    window.clearTimeout(bulkFreezeTimer);
    bulkFreezeTimer = null;
  }
  exitLandscapeScannerMode();
}

async function startBulkScanner() {
  try {
    if (bulkScanSoundEnabled) {
      ensureBulkAudioContext();
    }
    await tryEnterLandscapeScannerMode();
    bulkScannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    bulkScannerVideo.srcObject = bulkScannerStream;
    await bulkScannerVideo.play();

    if ('BarcodeDetector' in window) {
      bulkScannerDetector = new window.BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e']
      });
    } else {
      bulkScannerDetector = null;
    }

    bulkScannerStage.hidden = false;
    syncBulkScannerHeight();
    bulkScannerRunning = true;
    syncBulkScannerToggleLabel();

    if (bulkScannerTimer) window.clearInterval(bulkScannerTimer);
    bulkScannerTimer = window.setInterval(() => {
      bulkScanFrame().catch((err) => toast(err.message, true));
    }, 250);
  } catch (err) {
    bulkScannerRunning = false;
    syncBulkScannerToggleLabel();
    await exitLandscapeScannerMode();
    toast(`Camera error: ${err.message}`, true);
  }
}

async function toggleBulkScanner() {
  if (bulkScannerRunning) {
    stopBulkScanner();
    return;
  }
  await startBulkScanner();
}

function isDesktopMode() {
  return window.matchMedia('(min-width: 981px)').matches;
}

function setPairModalOpen(open) {
  if (!pairModal || !pairModalOverlay) return;
  pairModal.hidden = !open;
  pairModalOverlay.hidden = !open;
}

function clearRemoteTimers() {
  if (remotePairPollTimer) {
    window.clearInterval(remotePairPollTimer);
    remotePairPollTimer = null;
  }
  if (remoteExpireTimer) {
    window.clearInterval(remoteExpireTimer);
    remoteExpireTimer = null;
  }
  if (remoteStatusTimer) {
    window.clearInterval(remoteStatusTimer);
    remoteStatusTimer = null;
  }
}

async function stopRemoteSubscription() {
  if (!remoteChannel) return;
  await supabase.removeChannel(remoteChannel);
  remoteChannel = null;
}

function persistRemoteSession() {
  if (!remoteSessionId || !remoteSessionExpiresAt) return;
  localStorage.setItem(REMOTE_SESSION_KEY, JSON.stringify({
    scan_session_id: remoteSessionId,
    expires_at: remoteSessionExpiresAt
  }));
}

function clearPersistedRemoteSession() {
  localStorage.removeItem(REMOTE_SESSION_KEY);
}

function setRemoteBadge(state = 'off', text = '') {
  if (!remoteBadge) return;
  remoteBadge.classList.remove('is-on', 'is-off', 'is-expired');
  if (state === 'on') remoteBadge.classList.add('is-on');
  else if (state === 'expired') remoteBadge.classList.add('is-expired');
  else remoteBadge.classList.add('is-off');
  remoteBadge.textContent = text || (state === 'on' ? 'Remote Scanner: Connected' : 'Remote Scanner: Idle');
  if (bulkRemoteScanBtn) {
    bulkRemoteScanBtn.classList.remove('is-disconnecting');
    const isConnected = state === 'on';
    bulkRemoteScanBtn.classList.toggle('is-connected', isConnected);
    bulkRemoteScanBtn.setAttribute('aria-label', isConnected ? 'Disconnect phone scanner' : 'Pair phone scanner');
    bulkRemoteScanBtn.title = isConnected ? 'Disconnect Phone Scanner' : 'Pair Phone Scanner';
  }
}

function flashRemoteBadge() {
  if (!remoteBadge) return;
  remoteBadge.classList.remove('flash');
  void remoteBadge.offsetWidth;
  remoteBadge.classList.add('flash');
}

async function syncRemoteSessionState() {
  if (!remoteSessionId) return;
  const { data, error } = await supabase
    .from('scan_sessions')
    .select('status, expires_at')
    .eq('id', remoteSessionId)
    .maybeSingle();
  if (error || !data) return;
  if (data.status !== 'active') {
    remoteSessionId = null;
    remoteSessionExpiresAt = null;
    clearPersistedRemoteSession();
    await stopRemoteSubscription();
    setRemoteBadge('off', 'Remote Scanner: Idle');
    pairStatus.textContent = 'Session ended.';
    pairMeta.textContent = '';
    clearRemoteTimers();
    return;
  }
  remoteSessionExpiresAt = data.expires_at;
}

function startRemoteStatusMonitor() {
  if (!remoteSessionId) return;
  if (remoteStatusTimer) window.clearInterval(remoteStatusTimer);
  remoteStatusTimer = window.setInterval(() => {
    syncRemoteSessionState().catch(() => {});
  }, 2500);
}

function updatePairMeta() {
  if (!pairMeta) return;
  if (!remoteSessionExpiresAt) {
    pairMeta.textContent = '';
    return;
  }
  const remaining = new Date(remoteSessionExpiresAt).getTime() - Date.now();
  if (remaining <= 0) {
    pairMeta.textContent = 'Session expired';
    return;
  }
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  pairMeta.textContent = `Session ends in ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startRemoteExpiryTicker() {
  if (!remoteSessionExpiresAt) return;
  if (remoteExpireTimer) window.clearInterval(remoteExpireTimer);
  updatePairMeta();
  remoteExpireTimer = window.setInterval(() => {
    updatePairMeta();
    if (!remoteSessionExpiresAt) return;
    if (new Date(remoteSessionExpiresAt).getTime() <= Date.now()) {
      pairStatus.textContent = 'Session expired.';
      clearRemoteTimers();
      stopRemoteSubscription().catch(() => {});
      clearPersistedRemoteSession();
      setRemoteBadge('expired', 'Remote Scanner: Expired');
    }
  }, 1000);
}

async function subscribeRemoteScans(scanSessionId) {
  await stopRemoteSubscription();
  remoteChannel = supabase
    .channel(`remote-scan-bulk-${scanSessionId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'scan_events', filter: `scan_session_id=eq.${scanSessionId}` },
      (payload) => {
        const barcode = payload?.new?.barcode;
        if (!barcode) return;
        appendBulkSerial(String(barcode));
      }
    )
    .subscribe();
}

async function waitForPairedSession(pairingId) {
  clearRemoteTimers();
  remotePairPollTimer = window.setInterval(async () => {
    try {
      const { data, error } = await supabase
        .from('scan_sessions')
        .select('id, status, expires_at')
        .eq('pairing_challenge_id', pairingId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return;
      if (data.status !== 'active') return;
      remoteSessionId = data.id;
      remoteSessionExpiresAt = data.expires_at;
      pairStatus.textContent = 'Phone paired. Remote scanner active.';
      persistRemoteSession();
      setRemoteBadge('on', 'Remote Scanner: Connected');
      clearRemoteTimers();
      startRemoteExpiryTicker();
      startRemoteStatusMonitor();
      await subscribeRemoteScans(remoteSessionId);
      setPairModalOpen(false);
      window.setTimeout(() => flashRemoteBadge(), 220);
    } catch {
      // keep polling
    }
  }, 1200);
}

async function generatePairingQr() {
  if (pairingGenerateInFlight) return;
  pairingGenerateInFlight = true;
  if (pairRegenerateBtn) pairRegenerateBtn.disabled = true;
  try {
    await ensureSessionFresh();
    pairStatus.textContent = 'Generating pairing QR...';
    pairMeta.textContent = '';
    remotePairingId = null;
    if (pairQrCanvas) {
      const ctx = pairQrCanvas.getContext('2d');
      ctx?.clearRect(0, 0, pairQrCanvas.width, pairQrCanvas.height);
    }
    const { data, error } = await supabase.functions.invoke('pairing-create', {
      body: { context: 'bulk', ttl_seconds: 45 }
    });
    if (error) {
      pairStatus.textContent = 'Failed to create pairing.';
      toast(error.message, true);
      return;
    }
    remotePairingId = data.pairing_id;
    const payload = data.pairing_qr_payload || JSON.stringify({
      type: 'scan_pairing',
      pairing_id: data.pairing_id,
      challenge: data.challenge
    });
    if (window.QRCode?.toCanvas) {
      await window.QRCode.toCanvas(pairQrCanvas, payload, { width: 220, margin: 1 });
    } else {
      const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
      const ctx = pairQrCanvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = fallbackUrl;
      });
      ctx.clearRect(0, 0, pairQrCanvas.width, pairQrCanvas.height);
      ctx.drawImage(img, 0, 0, pairQrCanvas.width, pairQrCanvas.height);
    }
    pairStatus.textContent = 'Scan this QR with the shared phone.';
    pairMeta.textContent = `Pairing expires at ${new Date(data.expires_at).toLocaleTimeString()}`;
    await waitForPairedSession(remotePairingId);
  } finally {
    pairingGenerateInFlight = false;
    if (pairRegenerateBtn) pairRegenerateBtn.disabled = false;
  }
}

async function endRemoteSession() {
  try {
    await ensureSessionFresh();
    if (bulkRemoteScanBtn) {
      bulkRemoteScanBtn.classList.add('is-disconnecting');
      bulkRemoteScanBtn.disabled = true;
    }
    if (!remoteSessionId) {
      const raw = localStorage.getItem(REMOTE_SESSION_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const persistedId = String(parsed.scan_session_id || '').trim();
          if (persistedId) {
            remoteSessionId = persistedId;
          }
        } catch {
          // ignore parse issues
        }
      }
    }
    if (!remoteSessionId) {
      setRemoteBadge('off', 'Remote Scanner: Idle');
      return;
    }
    const { error } = await supabase.functions.invoke('scan-session-end', {
      body: { scan_session_id: remoteSessionId }
    });
    if (error) {
      toast(error.message, true);
      return;
    }
    remoteSessionId = null;
    remoteSessionExpiresAt = null;
    pairStatus.textContent = 'Session ended.';
    pairMeta.textContent = '';
    clearRemoteTimers();
    await stopRemoteSubscription();
    clearPersistedRemoteSession();
    setRemoteBadge('off', 'Remote Scanner: Idle');
  } finally {
    if (bulkRemoteScanBtn) bulkRemoteScanBtn.disabled = false;
  }
}

async function restoreGlobalRemoteSession() {
  const raw = localStorage.getItem(REMOTE_SESSION_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const id = String(parsed.scan_session_id || '').trim();
    const exp = String(parsed.expires_at || '').trim();
    if (!id || !exp) {
      clearPersistedRemoteSession();
      return;
    }
    if (new Date(exp).getTime() <= Date.now()) {
      clearPersistedRemoteSession();
      return;
    }
    remoteSessionId = id;
    remoteSessionExpiresAt = exp;
    pairStatus.textContent = 'Remote scanner active (global session).';
    setRemoteBadge('on', 'Remote Scanner: Connected');
    startRemoteExpiryTicker();
    startRemoteStatusMonitor();
    await subscribeRemoteScans(id);
  } catch {
    clearPersistedRemoteSession();
    setRemoteBadge('off', 'Remote Scanner: Idle');
  }
}

async function init() {
  initTheme();
  bindThemeToggle();
  bindSignOut(signOut);
  stopSessionKeepAlive = startSessionKeepAlive();
  if (!requireConfig()) {
    toast('Update config.js with Supabase config.', true);
    return;
  }

  const session = await getSession();
  if (!requireAuth(session)) {
    return;
  }

  const profile = await getCurrentProfile();
  if (profile.role !== ROLES.ADMIN) {
    toast('Admin role required.', true);
    window.location.href = './index.html';
    return;
  }

  if (adminLoadingPanel) {
    adminLoadingPanel.hidden = true;
  }
  if (adminTopbar) {
    adminTopbar.hidden = false;
    adminTopbar.style.display = '';
  }
  if (assetAdminSection) {
    assetAdminSection.hidden = false;
  }
  if (bulkCreateSection) {
    bulkCreateSection.hidden = false;
  }
  if (adminNav) {
    adminNav.hidden = false;
    adminNav.style.display = '';
  }
  initAdminNav();

  qs('#saveAssetBtn').addEventListener('click', saveAsset);
  qs('#loadByTagBtn').addEventListener('click', loadByTag);
  qs('#bulkCreateBtn').addEventListener('click', bulkCreateAssets);
  qs('#clearBulkSerialsBtn').addEventListener('click', () => {
    const hasSerials = (qs('#bulkSerials').value || '').trim().length > 0;
    if (!hasSerials) return;
    showBulkClearConfirm();
  });
  confirmClearBulkYes?.addEventListener('click', () => {
    qs('#bulkSerials').value = '';
    updateBulkSerialCount();
    hideBulkClearConfirm();
  });
  confirmClearBulkNo?.addEventListener('click', hideBulkClearConfirm);
  qs('#bulkSerials').addEventListener('input', updateBulkSerialCount);
  qs('#bulkSerials').addEventListener('input', syncBulkScannerHeight);
  qs('#bulkSerials').addEventListener('input', hideBulkClearConfirm);
  const saved = localStorage.getItem('bulkScanSoundEnabled');
  if (saved !== null) {
    bulkScanSoundEnabled = saved === '1';
  }
  syncBulkSoundButton();
  bulkScanSoundBtn?.addEventListener('click', () => {
    bulkScanSoundEnabled = !bulkScanSoundEnabled;
    localStorage.setItem('bulkScanSoundEnabled', bulkScanSoundEnabled ? '1' : '0');
    syncBulkSoundButton();
    if (bulkScanSoundEnabled) {
      ensureBulkAudioContext();
    }
  });
  bulkScannerToggleBtn?.addEventListener('click', () => {
    toggleBulkScanner().catch((err) => toast(err.message, true));
  });
  if (bulkRemoteScanBtn && !isDesktopMode()) {
    bulkRemoteScanBtn.hidden = true;
  }
  bulkRemoteScanBtn?.addEventListener('click', () => {
    if (bulkRemoteScanBtn.classList.contains('is-connected') || remoteSessionId) {
      endRemoteSession().catch((err) => toast(err.message, true));
      return;
    }
    setPairModalOpen(true);
    generatePairingQr().catch((err) => toast(err.message, true));
  });
  pairModalOverlay?.addEventListener('click', () => setPairModalOpen(false));
  pairModalCloseBtn?.addEventListener('click', () => setPairModalOpen(false));
  pairRegenerateBtn?.addEventListener('click', () => {
    generatePairingQr().catch((err) => toast(err.message, true));
  });
  pairEndSessionBtn?.addEventListener('click', () => {
    (async () => {
      if (remoteSessionId) {
        await endRemoteSession();
      }
      setPairModalOpen(false);
    })().catch((err) => toast(err.message, true));
  });
  setRemoteBadge('off', 'Remote Scanner: Idle');
  qs('#manufacturer').addEventListener('change', syncManufacturerInput);
  syncManufacturerInput();
  setEditMode(false);
  updateBulkSerialCount();
  syncBulkScannerToggleLabel();
  restoreGlobalRemoteSession().catch((err) => toast(err.message, true));
  const prefillTag = new URLSearchParams(window.location.search).get('tag');
  if (prefillTag) {
    qs('#assetTag').value = prefillTag.trim();
    await loadByTag();
  }
  window.addEventListener('resize', syncBulkScannerHeight);
  window.addEventListener('orientationchange', syncBulkScannerHeight);
  window.addEventListener('beforeunload', stopBulkScanner);
  window.addEventListener('beforeunload', () => {
    if (stopSessionKeepAlive) stopSessionKeepAlive();
    clearRemoteTimers();
    stopRemoteSubscription().catch(() => {});
  });
}

init().catch((err) => toast(err.message, true));

