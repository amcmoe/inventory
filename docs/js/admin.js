import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut } from './auth.js';
import { qs, toast, initTheme, bindThemeToggle, bindSignOut } from './ui.js';

const adminLoadingPanel = qs('#adminLoadingPanel');
const adminTopbar = qs('#adminTopbar');
const assetAdminSection = qs('#assetAdminSection');
const bulkCreateSection = qs('#bulkCreateSection');
const adminNav = qs('#adminNav');
const editOnlyFields = document.querySelectorAll('[data-edit-only]');
const bulkStartScannerBtn = qs('#bulkStartScannerBtn');
const bulkStopScannerBtn = qs('#bulkStopScannerBtn');
const bulkScannerStage = qs('#bulkScannerStage');
const bulkScannerVideo = qs('#bulkScannerVideo');
const bulkScannerFreeze = qs('#bulkScannerFreeze');
const bulkScannerOverlay = qs('#bulkScannerOverlay');
const bulkScannerCanvas = qs('#bulkScannerCanvas');
const bulkSerialCount = qs('#bulkSerialCount');
const bulkSerialsField = qs('#bulkSerials');
const bulkScanSoundToggle = qs('#bulkScanSoundToggle');

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
  if (!bulkScanSoundToggle?.checked) return;
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

function showBulkFreezeFrame(durationMs = 1200) {
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

function drawBulkOverlay(polygons) {
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

  ctx.strokeStyle = '#22c55e';
  ctx.shadowColor = 'rgba(34,197,94,0.55)';
  ctx.shadowBlur = 8;
  ctx.lineWidth = 3;

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
    p_location: qs('#location').value.trim() || null,
    p_building: qs('#building').value.trim() || null,
    p_room: qs('#room').value.trim() || null,
    p_service_start_date: qs('#serviceStartDate').value || null,
    p_asset_condition: qs('#assetCondition').value || null,
    p_comments: qs('#comments').value.trim() || null,
    p_ownership: qs('#ownership').value || null,
    p_warranty_expiration_date: qs('#warrantyExpirationDate').value || null,
    p_obsolete: qs('#obsolete').value === 'true',
    p_status: qs('#status').value,
    p_notes: qs('#notes').value.trim() || null
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
  qs('#location').value = asset.location || '';
  qs('#building').value = asset.building || '';
  qs('#room').value = asset.room || '';
  qs('#serviceStartDate').value = asset.service_start_date || '';
  qs('#assetCondition').value = asset.asset_condition || '';
  qs('#comments').value = asset.comments || '';
  qs('#ownership').value = asset.ownership || '';
  qs('#warrantyExpirationDate').value = asset.warranty_expiration_date || '';
  qs('#obsolete').value = asset.obsolete ? 'true' : 'false';
  qs('#status').value = editableStatus;
  qs('#notes').value = asset.notes || '';
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
  const tag = qs('#assetTag').value.trim();
  if (!tag) {
    toast('Enter a serial number.', true);
    return;
  }

  const { data, error } = await supabase
    .from('assets')
    .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, location, building, room, service_start_date, asset_condition, comments, ownership, warranty_expiration_date, obsolete, status, notes')
    .eq('asset_tag', tag)
    .maybeSingle();

  if (error) {
    toast(error.message, true);
    return;
  }

  if (!data) {
    toast('Asset not found for that tag.', true);
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

  for (const serial of serials) {
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
    if (error) {
      errors.push(`${serial}: ${error.message}`);
    } else {
      success += 1;
    }
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
    return;
  }
  current.push(serial);
  const field = qs('#bulkSerials');
  field.value = `${current.join('\n')}\n`;
  field.scrollTop = field.scrollHeight;
  field.selectionStart = field.value.length;
  field.selectionEnd = field.value.length;
  updateBulkSerialCount();
  toast(`Scanned ${serial}`);
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

async function handleBulkScan(rawValue) {
  const now = Date.now();
  if (!rawValue || (rawValue === lastBulkScan && now - lastBulkScanAt < 1500)) {
    return;
  }
  lastBulkScan = rawValue;
  lastBulkScanAt = now;
  const serial = extractScannedSerial(rawValue);
  appendBulkSerial(serial);
  playScanChime();
  showBulkFreezeFrame();
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

  if (bulkScannerDetector) {
    const codes = await bulkScannerDetector.detect(bulkScannerVideo);
    const polygons = (codes || [])
      .map((code) => code.cornerPoints)
      .filter((points) => Array.isArray(points) && points.length >= 4);
    drawBulkOverlay(polygons);
    if (codes?.length && codes[0].rawValue) {
      await handleBulkScan(codes[0].rawValue);
    }
    return;
  }

  if (!window.jsQR) return;
  const width = bulkScannerVideo.videoWidth || 640;
  const height = bulkScannerVideo.videoHeight || 480;
  bulkScannerCanvas.width = width;
  bulkScannerCanvas.height = height;
  const ctx = bulkScannerCanvas.getContext('2d');
  ctx.drawImage(bulkScannerVideo, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
  if (code?.data) {
    const loc = code.location;
    if (loc) {
      drawBulkOverlay([[loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner]]);
    } else {
      clearBulkOverlay();
    }
    await handleBulkScan(code.data);
  } else {
    clearBulkOverlay();
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
  if (bulkStartScannerBtn) bulkStartScannerBtn.disabled = false;
  if (bulkStopScannerBtn) bulkStopScannerBtn.disabled = true;
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
    ensureBulkAudioContext();
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
    bulkStartScannerBtn.disabled = true;
    bulkStopScannerBtn.disabled = false;

    if (bulkScannerTimer) window.clearInterval(bulkScannerTimer);
    bulkScannerTimer = window.setInterval(() => {
      bulkScanFrame().catch((err) => toast(err.message, true));
    }, 250);
  } catch (err) {
    await exitLandscapeScannerMode();
    toast(`Camera error: ${err.message}`, true);
  }
}

async function init() {
  initTheme();
  bindThemeToggle();
  bindSignOut(signOut);
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

  qs('#saveAssetBtn').addEventListener('click', saveAsset);
  qs('#loadByTagBtn').addEventListener('click', loadByTag);
  qs('#bulkCreateBtn').addEventListener('click', bulkCreateAssets);
  qs('#clearBulkSerialsBtn').addEventListener('click', () => {
    qs('#bulkSerials').value = '';
    updateBulkSerialCount();
  });
  qs('#bulkSerials').addEventListener('input', updateBulkSerialCount);
  qs('#bulkSerials').addEventListener('input', syncBulkScannerHeight);
  if (bulkScanSoundToggle) {
    const saved = localStorage.getItem('bulkScanSoundEnabled');
    if (saved !== null) {
      bulkScanSoundToggle.checked = saved === '1';
    }
    bulkScanSoundToggle.addEventListener('change', () => {
      localStorage.setItem('bulkScanSoundEnabled', bulkScanSoundToggle.checked ? '1' : '0');
      if (bulkScanSoundToggle.checked) {
        ensureBulkAudioContext();
      }
    });
  }
  bulkStartScannerBtn?.addEventListener('click', startBulkScanner);
  bulkStopScannerBtn?.addEventListener('click', stopBulkScanner);
  qs('#manufacturer').addEventListener('change', syncManufacturerInput);
  syncManufacturerInput();
  setEditMode(false);
  updateBulkSerialCount();
  window.addEventListener('resize', syncBulkScannerHeight);
  window.addEventListener('orientationchange', syncBulkScannerHeight);
  window.addEventListener('beforeunload', stopBulkScanner);
}

init().catch((err) => toast(err.message, true));

