import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh, startSessionKeepAlive } from './auth.js';
import { qs, toast, escapeHtml, initTheme, bindThemeToggle, bindSignOut, initAdminNav, initConnectionBadgeMonitor, loadSiteBrandingFromServer } from './ui.js';

const adminLoadingPanel = qs('#adminLoadingPanel');
const adminTopbar = qs('#adminTopbar');
const assetAdminSection = qs('#assetAdminSection');
const bulkCreateSection = qs('#bulkCreateSection');
const adminNav = qs('#sidebarNav');
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
const outForWarrantyRepairInput = qs('#outForWarrantyRepair');
const warrantyRepairToggleWrap = qs('#warrantyRepairToggleWrap');
const importExportBtn = qs('#importExportBtn');
const importExportMenu = qs('#importExportMenu');
const importAssetsCsvBtn = qs('#importAssetsCsvBtn');
const exportAllAssetsBtn = qs('#exportAllAssetsBtn');
const downloadTemplateCsvBtn = qs('#downloadTemplateCsvBtn');
const importAssetsFile = qs('#importAssetsFile');
const importPreviewSection = qs('#importPreviewSection');
const importSummaryText = qs('#importSummaryText');
const importErrorList = qs('#importErrorList');
const applyImportBtn = qs('#applyImportBtn');
const downloadImportErrorsBtn = qs('#downloadImportErrorsBtn');
const cancelImportBtn = qs('#cancelImportBtn');

const knownManufacturers = ['Apple', 'Dell', 'Lenovo', 'HP', 'Beelink'];
const knownModels = ['ThinkPad L13 G3', 'ThinkPad L13 G4', 'ThinkPad L13 G6', 'Chromebook 3100', 'Chromebook 3110', 'Chromebook 3120'];
const knownEquipmentTypes = ['Laptop', 'Chromebook', 'Tablet'];
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
let stopConnectionBadgeMonitor = null;
let currentAssetId = null;
let lockHeartbeatTimer = null;
let assetLocksChannel = null;
let currentLockOwner = null;
let pendingImportRows = [];
let pendingImportErrors = [];

function withTimeout(promise, ms, timeoutMessage) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

function getFunctionUrl(name) {
  const base = String(window.APP_CONFIG?.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  return `${base}/functions/v1/${name}`;
}

async function renderPairingQr(canvas, payload, size = 220) {
  if (!canvas) throw new Error('QR canvas missing.');
  if (window.QRCode?.toCanvas) {
    try {
      await withTimeout(
        window.QRCode.toCanvas(canvas, payload, { width: size, margin: 1 }),
        3500,
        'QR render timed out.'
      );
      return;
    } catch {
      // Fall through to fallback image render.
    }
  }
  const fallbackUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload)}`;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await withTimeout(
    new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = fallbackUrl;
    }),
    6000,
    'QR image load timed out.'
  );
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

async function invokeFunctionDirect(name, body, timeoutMs = 12000) {
  const url = getFunctionUrl(name);
  const anonKey = String(window.APP_CONFIG?.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    throw new Error('Supabase config missing.');
  }
  let token = '';
  try {
    const sessionResult = await withTimeout(
      supabase.auth.getSession(),
      2500,
      'Session lookup timed out.'
    );
    token = String(sessionResult?.data?.session?.access_token || '').trim();
  } catch {
    token = '';
  }
  const headers = {
    'Content-Type': 'application/json',
    apikey: anonKey
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
      signal: controller.signal,
      cache: 'no-store'
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = payload?.error || payload?.message || `Function ${name} failed (${response.status})`;
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }
    return payload;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Function ${name} timed out.`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

async function invokeFunctionRobust(name, body, timeoutMs = 15000) {
  const startedAt = Date.now();
  const remainingMs = () => Math.max(0, timeoutMs - (Date.now() - startedAt));
  const bounded = (maxMs, floorMs = 1200) => Math.max(floorMs, Math.min(maxMs, remainingMs()));
  try {
    if (remainingMs() <= 0) throw new Error(`Function ${name} timed out.`);
    const { data, error } = await withTimeout(
      supabase.functions.invoke(name, { body }),
      bounded(5000),
      `Function ${name} timed out.`
    );
    if (!error) return data;
    throw error;
  } catch (firstErr) {
    try {
      if (remainingMs() <= 0) throw firstErr;
      return await invokeFunctionDirect(name, body, bounded(5000));
    } catch (directErr) {
      try {
        if (remainingMs() > 2500) {
          await withTimeout(supabase.auth.refreshSession(), bounded(3000), 'Session refresh timed out.');
        }
      } catch {
        // ignore and allow one final direct retry
      }
      if (remainingMs() <= 0) throw (directErr || firstErr);
      return await invokeFunctionDirect(name, body, bounded(5000)).catch((retryErr) => {
        throw retryErr || directErr || firstErr;
      });
    }
  }
}

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

function currentModelValue() {
  const selected = qs('#model').value;
  if (selected === '__custom__') {
    return qs('#modelCustom').value.trim() || null;
  }
  return selected || null;
}

function syncModelInput() {
  const showCustom = qs('#model').value === '__custom__';
  qs('#modelCustom').hidden = !showCustom;
}

function setModelValue(value) {
  if (!value) {
    qs('#model').value = '';
    qs('#modelCustom').value = '';
    qs('#modelCustom').hidden = true;
    return;
  }
  if (knownModels.includes(value)) {
    qs('#model').value = value;
    qs('#modelCustom').value = '';
    qs('#modelCustom').hidden = true;
    return;
  }
  qs('#model').value = '__custom__';
  qs('#modelCustom').value = value;
  qs('#modelCustom').hidden = false;
}

function currentEquipmentTypeValue() {
  const selected = qs('#equipmentType').value;
  if (selected === '__custom__') {
    return qs('#equipmentTypeCustom').value.trim() || null;
  }
  return selected || null;
}

function syncEquipmentTypeInput() {
  const showCustom = qs('#equipmentType').value === '__custom__';
  qs('#equipmentTypeCustom').hidden = !showCustom;
}

function setEquipmentTypeValue(value) {
  if (!value) {
    qs('#equipmentType').value = '';
    qs('#equipmentTypeCustom').value = '';
    qs('#equipmentTypeCustom').hidden = true;
    return;
  }
  if (knownEquipmentTypes.includes(value)) {
    qs('#equipmentType').value = value;
    qs('#equipmentTypeCustom').value = '';
    qs('#equipmentTypeCustom').hidden = true;
    return;
  }
  qs('#equipmentType').value = '__custom__';
  qs('#equipmentTypeCustom').value = value;
  qs('#equipmentTypeCustom').hidden = false;
}

function setEditMode(isEditMode) {
  editOnlyFields.forEach((node) => {
    node.hidden = !isEditMode;
  });
  syncWarrantyRepairFieldVisibility();
}

function syncWarrantyRepairFieldVisibility() {
  if (!warrantyRepairToggleWrap || !outForWarrantyRepairInput) return;
  const statusFieldWrap = qs('#status')?.closest?.('[data-edit-only]');
  const isEditMode = statusFieldWrap ? !statusFieldWrap.hidden : true;
  const isRepair = qs('#status')?.value === 'repair';
  if (!isEditMode || !isRepair) {
    warrantyRepairToggleWrap.hidden = true;
    outForWarrantyRepairInput.checked = false;
    return;
  }
  warrantyRepairToggleWrap.hidden = false;
}

async function acquireAssetLock(assetId) {
  if (!assetId) return null;

  const profile = await getCurrentProfile();
  const displayName = profile?.display_name || 'Unknown User';

  try {
    const { data, error } = await supabase.rpc('acquire_asset_lock', {
      p_asset_id: assetId,
      p_locked_by_name: displayName
    });

    if (error) {
      console.error('Lock acquisition error:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Failed to acquire lock:', err);
    return null;
  }
}

async function releaseAssetLock(assetId) {
  if (!assetId) return;

  try {
    await supabase.rpc('release_asset_lock', {
      p_asset_id: assetId
    });
  } catch (err) {
    console.error('Failed to release lock:', err);
  }
}

function stopLockHeartbeat() {
  if (lockHeartbeatTimer) {
    window.clearInterval(lockHeartbeatTimer);
    lockHeartbeatTimer = null;
  }
}

function startLockHeartbeat(assetId) {
  stopLockHeartbeat();

  if (!assetId) return;

  lockHeartbeatTimer = window.setInterval(async () => {
    try {
      const profile = await getCurrentProfile();
      const displayName = profile?.display_name || 'Unknown User';

      await supabase.rpc('acquire_asset_lock', {
        p_asset_id: assetId,
        p_locked_by_name: displayName
      });
    } catch (err) {
      console.error('Heartbeat failed:', err);
    }
  }, 60000);
}

async function subscribeToAssetLocks() {
  if (assetLocksChannel) {
    await supabase.removeChannel(assetLocksChannel);
  }

  assetLocksChannel = supabase
    .channel('asset-locks-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'asset_locks'
      },
      (payload) => {
        handleLockChange(payload);
      }
    )
    .subscribe();
}

function handleLockChange(payload) {
  const newRecord = payload.new;
  const oldRecord = payload.old;
  const eventType = payload.eventType;

  if (!currentAssetId) return;

  if (eventType === 'INSERT' || eventType === 'UPDATE') {
    if (newRecord.asset_id === currentAssetId) {
      const session = supabase.auth.getSession().then(({ data }) => {
        const currentUserId = data.session?.user?.id;

        if (newRecord.locked_by !== currentUserId) {
          currentLockOwner = {
            user_id: newRecord.locked_by,
            name: newRecord.locked_by_name,
            locked_at: newRecord.locked_at
          };
          updateLockUI();
        } else {
          currentLockOwner = null;
          updateLockUI();
        }
      });
    }
  } else if (eventType === 'DELETE') {
    if (oldRecord.asset_id === currentAssetId) {
      currentLockOwner = null;
      updateLockUI();
    }
  }
}

function updateLockUI() {
  const formContainer = assetAdminSection?.querySelector('.panel-body');
  if (!formContainer) return;

  let lockBanner = formContainer.querySelector('.asset-lock-banner');

  if (currentLockOwner) {
    if (!lockBanner) {
      lockBanner = document.createElement('div');
      lockBanner.className = 'asset-lock-banner';
      const h2 = formContainer.querySelector('h2');
      if (h2) {
        h2.after(lockBanner);
      } else {
        formContainer.prepend(lockBanner);
      }
    }

    const lockedTime = new Date(currentLockOwner.locked_at).toLocaleTimeString();
    lockBanner.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20" style="display: inline-block; vertical-align: middle; margin-right: 8px;">
        <rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2"></path>
      </svg>
      <strong>Locked by ${escapeHtml(currentLockOwner.name)}</strong> at ${lockedTime}.
      This asset is currently being edited by another user.
    `;

    const saveBtn = qs('#saveAssetBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.title = 'Asset is locked by another user';
    }

    const inputs = formContainer.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      if (input.id !== 'assetTag' && input.id !== 'assetId') {
        input.disabled = true;
      }
    });
  } else {
    if (lockBanner) {
      lockBanner.remove();
    }

    const saveBtn = qs('#saveAssetBtn');
    if (saveBtn && currentAssetId) {
      saveBtn.disabled = false;
      saveBtn.title = '';
    }

    const inputs = formContainer.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.disabled = false;
    });
  }
}

async function handleAssetLoad(assetId) {
  console.log('[LOCK] handleAssetLoad called with assetId:', assetId);

  if (currentAssetId && currentAssetId !== assetId) {
    await releaseAssetLock(currentAssetId);
    stopLockHeartbeat();
  }

  currentAssetId = assetId;
  currentLockOwner = null;

  if (!assetId) {
    console.log('[LOCK] No assetId, skipping lock');
    updateLockUI();
    return;
  }

  console.log('[LOCK] Attempting to acquire lock for asset:', assetId);
  const lockResult = await acquireAssetLock(assetId);
  console.log('[LOCK] Lock result:', lockResult);

  if (lockResult && !lockResult.success) {
    console.log('[LOCK] Lock acquisition failed - asset is locked by another user');
    console.log('[LOCK] Lock owner details:', lockResult);
    currentLockOwner = {
      user_id: lockResult.locked_by,
      name: lockResult.locked_by_name,
      locked_at: lockResult.locked_at
    };
    updateLockUI();
    toast(`Asset is locked by ${lockResult.locked_by_name}`, true);
  } else if (lockResult && lockResult.success) {
    console.log('[LOCK] Lock acquired successfully');
    console.log('[LOCK] You now own this lock');
    if (lockResult.is_stale && lockResult.previous_lock_owner) {
      toast(`Took over stale lock from ${lockResult.previous_lock_owner}`);
    }
    startLockHeartbeat(assetId);
    updateLockUI();
  } else {
    console.log('[LOCK] Unexpected lock result:', lockResult);
  }
}

function sanitizeLookupTerm(term) {
  return String(term || '')
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function setImportExportMenuOpen(open) {
  if (importExportMenu) importExportMenu.hidden = !open;
  if (importExportBtn) importExportBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
    i += 1;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeImportHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const IMPORT_HEADER_ALIASES = {
  assettag: 'asset_tag',
  serial: 'serial',
  manufacturer: 'manufacturer',
  model: 'model',
  equipmenttype: 'equipment_type',
  type: 'equipment_type',
  building: 'building',
  room: 'room',
  servicestartdate: 'service_start_date',
  inservicesince: 'service_start_date',
  ownership: 'ownership',
  ownedorleased: 'ownership',
  warrantyexpirationdate: 'warranty_expiration_date',
  warrantydate: 'warranty_expiration_date',
  obsolete: 'obsolete',
  status: 'status',
  outforwarrantyrepair: 'out_for_warranty_repair',
  outforrepair: 'out_for_warranty_repair',
  comments: 'comments'
};

function parseBooleanCell(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (['1', 'true', 'yes', 'y'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n'].includes(raw)) return false;
  return null;
}

function parseDateCell(value) {
  const raw = String(value || '').trim();
  if (!raw) return { value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { value: raw };
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const mm = mdy[1].padStart(2, '0');
    const dd = mdy[2].padStart(2, '0');
    return { value: `${mdy[3]}-${mm}-${dd}` };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: `Invalid date "${raw}"` };
  return { value: d.toISOString().slice(0, 10) };
}

function normalizeStatusCell(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!raw) return { value: 'available' };
  if (raw === 'assigned') return { value: 'checked_out' };
  if (['available', 'checked_out', 'repair', 'retired'].includes(raw)) return { value: raw };
  return { error: `Invalid status "${value}"` };
}

function normalizeOwnershipCell(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return { value: null };
  if (raw === 'owned' || raw === 'leased') return { value: raw };
  return { error: `Invalid ownership "${value}"` };
}

function mapImportHeaders(headerRow = []) {
  const indexByKey = {};
  headerRow.forEach((header, index) => {
    const normalized = normalizeImportHeader(header);
    const key = IMPORT_HEADER_ALIASES[normalized];
    if (key && indexByKey[key] == null) indexByKey[key] = index;
  });
  return indexByKey;
}

function importCell(row, indexByKey, key) {
  const idx = indexByKey[key];
  if (idx == null) return '';
  return String(row[idx] ?? '').trim();
}

function clearImportPreview() {
  pendingImportRows = [];
  pendingImportErrors = [];
  if (importPreviewSection) importPreviewSection.hidden = true;
  if (importErrorList) {
    importErrorList.hidden = true;
    importErrorList.innerHTML = '';
  }
  if (importSummaryText) {
    importSummaryText.textContent = 'Upload a CSV to preview row validation before import.';
  }
  if (applyImportBtn) applyImportBtn.hidden = true;
  if (downloadImportErrorsBtn) downloadImportErrorsBtn.hidden = true;
  if (cancelImportBtn) cancelImportBtn.hidden = true;
  if (importAssetsFile) importAssetsFile.value = '';
}

function renderImportPreview({ totalRows = 0, validRows = 0, createCount = 0, updateCount = 0, errors = [] }) {
  pendingImportErrors = Array.isArray(errors) ? errors : [];
  if (importPreviewSection) importPreviewSection.hidden = false;
  if (importSummaryText) {
    importSummaryText.textContent =
      `Rows: ${totalRows}. Valid: ${validRows}. Creates: ${createCount}. Updates: ${updateCount}. Errors: ${pendingImportErrors.length}.`;
  }
  if (importErrorList) {
    if (!pendingImportErrors.length) {
      importErrorList.hidden = true;
      importErrorList.innerHTML = '';
    } else {
      const max = 80;
      const list = pendingImportErrors.slice(0, max).map((entry) => (
        `<div class="admin-import-error-item">Row ${entry.row}: ${escapeHtml(entry.message)}</div>`
      ));
      if (pendingImportErrors.length > max) {
        list.push(`<div class="admin-import-error-item muted">...and ${pendingImportErrors.length - max} more</div>`);
      }
      importErrorList.hidden = false;
      importErrorList.innerHTML = list.join('');
    }
  }
  if (applyImportBtn) applyImportBtn.hidden = !validRows || pendingImportErrors.length > 0;
  if (downloadImportErrorsBtn) downloadImportErrorsBtn.hidden = pendingImportErrors.length === 0;
  if (cancelImportBtn) cancelImportBtn.hidden = false;
}

async function fetchExistingAssetIdMap(assetTags = []) {
  const tags = [...new Set(assetTags.map((tag) => String(tag || '').trim()).filter(Boolean))];
  const idMap = new Map();
  const CHUNK = 300;
  for (let i = 0; i < tags.length; i += CHUNK) {
    const chunk = tags.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('assets')
      .select('id, asset_tag')
      .in('asset_tag', chunk);
    if (error) throw error;
    (data || []).forEach((row) => {
      const tag = String(row?.asset_tag || '').trim();
      const id = String(row?.id || '').trim();
      if (tag && id) idMap.set(tag, id);
    });
  }
  return idMap;
}

async function prepareImportRows(csvText) {
  const rows = parseCsvText(csvText).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
  if (!rows.length) {
    return { totalRows: 0, validRows: 0, createCount: 0, updateCount: 0, errors: [{ row: 1, message: 'CSV is empty.' }], preparedRows: [] };
  }
  const header = rows[0];
  const dataRows = rows.slice(1);
  const indexByKey = mapImportHeaders(header);
  const errors = [];
  const prepared = [];

  if (indexByKey.asset_tag == null && indexByKey.serial == null) {
    errors.push({ row: 1, message: 'Missing required header: asset_tag or serial.' });
  }

  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2;
    const assetTagCell = importCell(row, indexByKey, 'asset_tag');
    const serialCell = importCell(row, indexByKey, 'serial');
    const normalizedTag = assetTagCell || serialCell;
    if (!normalizedTag) {
      errors.push({ row: rowNum, message: 'Missing asset tag/serial.' });
      return;
    }
    if (assetTagCell && serialCell && assetTagCell !== serialCell) {
      errors.push({ row: rowNum, message: `asset_tag "${assetTagCell}" and serial "${serialCell}" must match.` });
      return;
    }

    const statusResult = normalizeStatusCell(importCell(row, indexByKey, 'status'));
    if (statusResult.error) {
      errors.push({ row: rowNum, message: statusResult.error });
      return;
    }
    if (statusResult.value === 'checked_out') {
      errors.push({ row: rowNum, message: 'Status "checked_out/Assigned" cannot be imported from Asset Management CSV.' });
      return;
    }

    const ownershipResult = normalizeOwnershipCell(importCell(row, indexByKey, 'ownership'));
    if (ownershipResult.error) {
      errors.push({ row: rowNum, message: ownershipResult.error });
      return;
    }

    const serviceDateResult = parseDateCell(importCell(row, indexByKey, 'service_start_date'));
    if (serviceDateResult.error) {
      errors.push({ row: rowNum, message: serviceDateResult.error });
      return;
    }
    const warrantyDateResult = parseDateCell(importCell(row, indexByKey, 'warranty_expiration_date'));
    if (warrantyDateResult.error) {
      errors.push({ row: rowNum, message: warrantyDateResult.error });
      return;
    }

    const obsoleteRaw = importCell(row, indexByKey, 'obsolete');
    const obsoleteParsed = parseBooleanCell(obsoleteRaw);
    if (obsoleteRaw && obsoleteParsed == null) {
      errors.push({ row: rowNum, message: `Invalid obsolete value "${obsoleteRaw}"` });
      return;
    }
    const repairOutRaw = importCell(row, indexByKey, 'out_for_warranty_repair');
    const repairOutParsed = parseBooleanCell(repairOutRaw);
    if (repairOutRaw && repairOutParsed == null) {
      errors.push({ row: rowNum, message: `Invalid out_for_warranty_repair value "${repairOutRaw}"` });
      return;
    }

    const status = statusResult.value || 'available';
    prepared.push({
      rowNum,
      assetTag: normalizedTag,
      payload: {
        p_id: null,
        p_asset_tag: normalizedTag,
        p_serial: normalizedTag,
        p_equipment: null,
        p_device_name: importCell(row, indexByKey, 'model') || normalizedTag,
        p_manufacturer: importCell(row, indexByKey, 'manufacturer') || null,
        p_model: importCell(row, indexByKey, 'model') || null,
        p_equipment_type: importCell(row, indexByKey, 'equipment_type') || null,
        p_location: null,
        p_building: importCell(row, indexByKey, 'building') || null,
        p_room: importCell(row, indexByKey, 'room') || null,
        p_service_start_date: serviceDateResult.value || null,
        p_asset_condition: null,
        p_comments: importCell(row, indexByKey, 'comments') || null,
        p_ownership: ownershipResult.value,
        p_warranty_expiration_date: warrantyDateResult.value || null,
        p_obsolete: obsoleteParsed === true,
        p_status: status,
        p_notes: null,
        p_out_for_warranty_repair: status === 'repair' && repairOutParsed === true
      }
    });
  });

  if (errors.length) {
    return {
      totalRows: dataRows.length,
      validRows: prepared.length,
      createCount: 0,
      updateCount: 0,
      errors,
      preparedRows: prepared
    };
  }

  const idMap = await fetchExistingAssetIdMap(prepared.map((row) => row.assetTag));
  let createCount = 0;
  let updateCount = 0;
  prepared.forEach((entry) => {
    const existingId = idMap.get(entry.assetTag) || null;
    entry.payload.p_id = existingId;
    if (existingId) updateCount += 1;
    else createCount += 1;
  });

  return {
    totalRows: dataRows.length,
    validRows: prepared.length,
    createCount,
    updateCount,
    errors,
    preparedRows: prepared
  };
}

function downloadImportErrorsCsv() {
  if (!pendingImportErrors.length) {
    toast('No import errors to download.', true);
    return;
  }
  const lines = ['row,error'];
  pendingImportErrors.forEach((entry) => {
    lines.push(`${csvEscape(entry.row)},${csvEscape(entry.message)}`);
  });
  downloadBlob(`asset-import-errors-${Date.now()}.csv`, 'text/csv;charset=utf-8', `${lines.join('\n')}\n`);
}

async function handleImportFileSelection(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  const text = await file.text();
  const preview = await prepareImportRows(text);
  pendingImportRows = preview.preparedRows || [];
  renderImportPreview(preview);
  if (preview.errors.length) {
    toast(`Import preview found ${preview.errors.length} validation errors.`, true);
    return;
  }
  toast(`Import preview ready: ${preview.validRows} rows valid.`);
}

async function applyPendingImport() {
  if (!pendingImportRows.length) {
    toast('No validated import rows to apply.', true);
    return;
  }
  const ok = window.confirm(`Apply import for ${pendingImportRows.length} assets?`);
  if (!ok) return;

  let success = 0;
  const failures = [];
  const BATCH = 12;
  for (let i = 0; i < pendingImportRows.length; i += BATCH) {
    const batch = pendingImportRows.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (entry) => {
      const { error } = await supabase.rpc('admin_upsert_asset', entry.payload);
      return { entry, error };
    }));
    results.forEach(({ entry, error }) => {
      if (error) {
        failures.push({ row: entry.rowNum, message: error.message || 'Unknown import error.' });
      } else {
        success += 1;
      }
    });
  }

  if (failures.length) {
    pendingImportErrors = failures;
    if (downloadImportErrorsBtn) downloadImportErrorsBtn.hidden = false;
    renderImportPreview({
      totalRows: pendingImportRows.length,
      validRows: pendingImportRows.length - failures.length,
      createCount: 0,
      updateCount: 0,
      errors: failures
    });
    toast(`Imported ${success}/${pendingImportRows.length}. Download error CSV for failures.`, true);
    return;
  }

  toast(`Import complete. ${success} assets upserted.`);
  clearImportPreview();
}

async function exportAssetsCsv() {
  await ensureSessionFresh();
  const { data, error } = await supabase
    .from('assets')
    .select('asset_tag, serial, manufacturer, model, equipment_type, building, room, service_start_date, ownership, warranty_expiration_date, obsolete, status, out_for_warranty_repair, comments')
    .order('asset_tag', { ascending: true })
    .limit(20000);
  if (error) {
    toast(error.message, true);
    return;
  }
  const rows = data || [];
  const headers = [
    'asset_tag',
    'serial',
    'manufacturer',
    'model',
    'equipment_type',
    'building',
    'room',
    'service_start_date',
    'ownership',
    'warranty_expiration_date',
    'obsolete',
    'status',
    'out_for_warranty_repair',
    'comments'
  ];
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const values = [
      row.asset_tag,
      row.serial,
      row.manufacturer,
      row.model,
      row.equipment_type,
      row.building,
      row.room,
      row.service_start_date,
      row.ownership,
      row.warranty_expiration_date,
      row.obsolete ? 'true' : 'false',
      row.status,
      row.out_for_warranty_repair ? 'true' : 'false',
      row.comments
    ];
    lines.push(values.map(csvEscape).join(','));
  });
  downloadBlob(`assets-export-${Date.now()}.csv`, 'text/csv;charset=utf-8', `${lines.join('\n')}\n`);
  toast(`Exported ${rows.length} assets.`);
}

function downloadImportTemplateCsv() {
  const headers = [
    'asset_tag',
    'serial',
    'manufacturer',
    'model',
    'equipment_type',
    'building',
    'room',
    'service_start_date',
    'ownership',
    'warranty_expiration_date',
    'obsolete',
    'status',
    'out_for_warranty_repair',
    'comments'
  ];
  const sampleRows = [
    [
      'PW063AAA',
      'PW063AAA',
      'Lenovo',
      'ThinkPad L13 G4',
      'Laptop',
      'Boiling Springs High School',
      '102',
      '2024-08-15',
      'owned',
      '2028-08-15',
      'false',
      'available',
      'false',
      'Ready for assignment'
    ],
    [
      'PW063AAB',
      'PW063AAB',
      'Dell',
      'Chromebook 3110',
      'Chromebook',
      'Yellow Breeches Middle School',
      '',
      '2023-09-01',
      'owned',
      '2027-09-01',
      'false',
      'repair',
      'true',
      'Cracked screen sent for warranty repair'
    ]
  ];
  const lines = [
    headers.join(','),
    ...sampleRows.map((row) => row.map(csvEscape).join(','))
  ];
  downloadBlob('asset-import-template.csv', 'text/csv;charset=utf-8', `${lines.join('\n')}\n`);
  toast('Downloaded import template CSV.');
}

function getFormValues() {
  const assetTag = qs('#assetTag').value.trim() || null;
  const model = currentModelValue();
  const derivedDeviceName = model || assetTag;
  return {
    p_id: qs('#assetId').value.trim() || null,
    p_asset_tag: assetTag,
    p_serial: assetTag,
    p_equipment: null,
    p_device_name: derivedDeviceName,
    p_manufacturer: currentManufacturerValue(),
    p_model: model,
    p_equipment_type: currentEquipmentTypeValue(),
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
    p_out_for_warranty_repair: qs('#status').value === 'repair' && Boolean(outForWarrantyRepairInput?.checked),
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
  setModelValue(asset.model || '');
  setEquipmentTypeValue(asset.equipment_type || '');
  qs('#building').value = asset.building || '';
  qs('#room').value = asset.room || '';
  qs('#serviceStartDate').value = asset.service_start_date || '';
  const cleanComments = String(asset.comments || '')
    .replace(/\s*\(tx\s+\d+\)/gi, '')
    .replace(/\s*-\s*OUT to\s+/gi, ' - Assigned to ')
    .replace(/\s*-\s*IN from\s+/gi, ' - Returned by ');
  qs('#comments').value = cleanComments;
  const damageHistoryList = qs('#damageHistoryList');
  if (damageHistoryList) damageHistoryList.textContent = 'Load an asset to view damage history.';
  qs('#ownership').value = asset.ownership || '';
  qs('#warrantyExpirationDate').value = asset.warranty_expiration_date || '';
  qs('#obsolete').value = asset.obsolete ? 'true' : 'false';
  qs('#status').value = editableStatus;
  if (outForWarrantyRepairInput) {
    outForWarrantyRepairInput.checked = editableStatus === 'repair' && Boolean(asset.out_for_warranty_repair);
  }
  setEditMode(Boolean(asset.id));
  syncWarrantyRepairFieldVisibility();
}

function formatHistoryTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts || '-');
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

async function loadAssignmentHistory(assetId, fallbackComments = '') {
  const commentsField = qs('#comments');
  if (!commentsField) return;
  commentsField.value = 'Loading...';

  const { data: txRows, error: txError } = await supabase
    .from('transactions')
    .select('id, action, occurred_at, assignee_person_id, performed_by_user_id, people(display_name)')
    .eq('asset_id', assetId)
    .order('occurred_at', { ascending: false })
    .limit(200);

  if (txError) {
    commentsField.value = String(fallbackComments || '').replace(/\s*\(tx\s+\d+\)/gi, '');
    return;
  }

  const rows = Array.isArray(txRows) ? txRows : [];
  if (!rows.length) {
    commentsField.value = String(fallbackComments || '').replace(/\s*\(tx\s+\d+\)/gi, '') || 'No assignment history yet.';
    return;
  }

  const performerIds = [...new Set(rows.map((r) => String(r?.performed_by_user_id || '').trim()).filter(Boolean))];
  const performerNameById = new Map();
  if (performerIds.length) {
    const { data: profRows } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', performerIds);
    (profRows || []).forEach((p) => {
      performerNameById.set(String(p.user_id), String(p.display_name || '').trim() || 'Unknown');
    });
  }

  const historyLines = rows.map((row) => {
    const when = formatHistoryTime(row?.occurred_at);
    const assignee = String(row?.people?.display_name || '').trim() || 'Unassigned';
    const tech = performerNameById.get(String(row?.performed_by_user_id || '')) || 'Unknown';
    if (row?.action === 'out') return `${when} - Assigned to ${assignee}`;
    if (row?.action === 'in') return `${when} - Returned by ${tech}`;
    return `${when} - ${String(row?.action || 'update').toUpperCase()}`;
  });
  commentsField.value = historyLines.join('\n');
}

function formatDamageHistoryRow(row) {
  const when = row?.created_at
    ? new Date(row.created_at).toLocaleString()
    : '-';
  const note = String(row?.notes || row?.summary || '').trim() || '-';
  const assignee = String(row?.assignee_name || '').trim() || 'Unassigned';
  const reporter = String(row?.reported_by_name || '').trim() || 'Unknown';
  return `${when} - ${note} (Assigned: ${assignee}, Reported by: ${reporter})`;
}

async function loadDamageHistory(assetId, assetTag) {
  const damageList = qs('#damageHistoryList');
  if (!damageList) return;
  damageList.textContent = 'Loading...';
  const { data, error } = await supabase
    .from('damage_reports')
    .select('id, created_at, summary, notes, assignee_name, reported_by_name')
    .eq('asset_id', assetId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    damageList.textContent = 'Could not load damage history.';
    return;
  }
  if (!Array.isArray(data) || !data.length) {
    damageList.textContent = 'No damage reports yet.';
    return;
  }
  const tag = String(assetTag || '').trim();
  damageList.innerHTML = data.map((row) => {
    const reportText = escapeHtml(formatDamageHistoryRow(row));
    const reportId = Number(row?.id);
    const linkHref = `./index.html?tag=${encodeURIComponent(tag)}&open=damage${Number.isFinite(reportId) ? `&report=${encodeURIComponent(String(reportId))}` : ''}`;
    return `
      <div class="admin-damage-item">
        <div class="admin-damage-text">${reportText}</div>
        <a class="btn ghost" href="${linkHref}" target="_blank" rel="noopener noreferrer">Open</a>
      </div>
    `;
  }).join('');
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
    .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, location, building, room, service_start_date, asset_condition, comments, ownership, warranty_expiration_date, obsolete, status, out_for_warranty_repair, notes')
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
  await handleAssetLoad(data.id);
  await loadAssignmentHistory(data.id, data.comments || '');
  await loadDamageHistory(data.id, data.asset_tag || data.serial || '');
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
  remoteBadge.hidden = state !== 'on';
  if (state === 'on') remoteBadge.classList.add('is-on');
  else if (state === 'expired') remoteBadge.classList.add('is-expired');
  else remoteBadge.classList.add('is-off');
  remoteBadge.textContent = text || 'Remote Scanner: Connected';
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
    ensureSessionFresh().catch(() => {});
    pairStatus.textContent = 'Generating pairing QR...';
    pairMeta.textContent = '';
    remotePairingId = null;
    if (pairQrCanvas) {
      const ctx = pairQrCanvas.getContext('2d');
      ctx?.clearRect(0, 0, pairQrCanvas.width, pairQrCanvas.height);
    }
    const data = await invokeFunctionRobust('pairing-create', { context: 'bulk', ttl_seconds: 45 }, 12000);
    remotePairingId = data.pairing_id;
    const payload = data.pairing_qr_payload || JSON.stringify({
      type: 'scan_pairing',
      pairing_id: data.pairing_id,
      challenge: data.challenge
    });
    await renderPairingQr(pairQrCanvas, payload, 220);
    pairStatus.textContent = 'Scan this QR with the shared phone.';
    pairMeta.textContent = `Pairing expires at ${new Date(data.expires_at).toLocaleTimeString()}`;
    await waitForPairedSession(remotePairingId);
  } catch (err) {
    pairStatus.textContent = 'Could not generate pairing. Try Regenerate QR.';
    pairMeta.textContent = '';
    toast(err?.message || 'Could not generate pairing QR.', true);
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
    const { data, error } = await supabase.functions.invoke('scan-session-end', {
      body: { scan_session_id: remoteSessionId }
    });
    if (error) {
      toast(error.message, true);
      return;
    }
    if (data?.event_emitted === false) {
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      await syncRemoteSessionState().catch(() => {});
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
  if (!profile || profile.role !== ROLES.ADMIN) {
    toast('Admin role required.', true);
    window.location.href = './index.html';
    return;
  }
  await loadSiteBrandingFromServer({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh
  });

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
  stopConnectionBadgeMonitor = initConnectionBadgeMonitor({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh,
    badgeSelector: '#connectionBadge'
  });

  qs('#saveAssetBtn').addEventListener('click', saveAsset);
  qs('#loadByTagBtn').addEventListener('click', loadByTag);
  importExportBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    setImportExportMenuOpen(Boolean(importExportMenu?.hidden));
  });
  importAssetsCsvBtn?.addEventListener('click', () => {
    setImportExportMenuOpen(false);
    importAssetsFile?.click();
  });
  exportAllAssetsBtn?.addEventListener('click', () => {
    setImportExportMenuOpen(false);
    exportAssetsCsv().catch((err) => toast(err.message, true));
  });
  downloadTemplateCsvBtn?.addEventListener('click', () => {
    setImportExportMenuOpen(false);
    downloadImportTemplateCsv();
  });
  importAssetsFile?.addEventListener('change', (event) => {
    handleImportFileSelection(event).catch((err) => toast(err.message, true));
  });
  applyImportBtn?.addEventListener('click', () => {
    applyPendingImport().catch((err) => toast(err.message, true));
  });
  cancelImportBtn?.addEventListener('click', clearImportPreview);
  downloadImportErrorsBtn?.addEventListener('click', downloadImportErrorsCsv);
  document.addEventListener('click', (event) => {
    const target = event?.target;
    const inPopover = target && target.closest && target.closest('#bulkImportExportPopover');
    if (!inPopover) setImportExportMenuOpen(false);
  });
  qs('#assetTag').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    loadByTag().catch((err) => toast(err.message, true));
  });
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
  qs('#model').addEventListener('change', syncModelInput);
  syncModelInput();
  qs('#equipmentType').addEventListener('change', syncEquipmentTypeInput);
  syncEquipmentTypeInput();
  qs('#status').addEventListener('change', syncWarrantyRepairFieldVisibility);
  setEditMode(false);
  clearImportPreview();
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
  subscribeToAssetLocks().catch((err) => toast(err.message, true));

  window.addEventListener('beforeunload', stopBulkScanner);
  window.addEventListener('beforeunload', () => {
    if (currentAssetId) {
      releaseAssetLock(currentAssetId).catch(() => {});
    }
    stopLockHeartbeat();
    if (assetLocksChannel) {
      supabase.removeChannel(assetLocksChannel).catch(() => {});
    }
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
    if (stopSessionKeepAlive) stopSessionKeepAlive();
    clearRemoteTimers();
    stopRemoteSubscription().catch(() => {});
  });

  window.addEventListener('pagehide', () => {
    if (currentAssetId) {
      navigator.sendBeacon?.('/api/release-lock', JSON.stringify({ asset_id: currentAssetId }));
      releaseAssetLock(currentAssetId).catch(() => {});
    }
  });
}

init().catch((err) => toast(err.message, true));
