import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, sendMagicLink, signOut } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut } from './ui.js';

const authPanel = qs('#authPanel');
const authShell = qs('#authShell');
const dashboardShell = qs('#dashboardShell');
const indexTopbar = qs('#indexTopbar');
const searchPanel = qs('#searchPanel');
const mainNav = qs('#mainNav');
const authMessage = qs('#authMessage');
const userMeta = qs('#userMeta');

const assetTbody = qs('#assetTbody');

const searchInput = qs('#searchInput');
const statusFilter = qs('#statusFilter');
const typeFilter = qs('#typeFilter');
const clearFiltersBtn = qs('#clearFiltersBtn');
const startScannerBtn = qs('#startScannerBtn');
const stopScannerBtn = qs('#stopScannerBtn');
const scannerStage = qs('#scannerStage');
const scannerVideo = qs('#scannerVideo');
const scannerCanvas = qs('#scannerCanvas');

let currentProfile = null;
let debounceTimer = null;
let scannerStream = null;
let scannerTimer = null;
let scannerDetector = null;
let lastScanned = '';
let lastScannedAt = 0;

function renderSearchPrompt() {
  assetTbody.innerHTML = '<tr><td colspan="7" class="dim">Type a serial or model to search for assets.</td></tr>';
  window.updateKpisFromTable?.();
}

function renderEmpty() {
  assetTbody.innerHTML = '<tr><td colspan="7" class="dim">No assets found for the current filters.</td></tr>';
  window.updateKpisFromTable?.();
}

function fillFilterOptions(assets) {
  const equipmentTypes = [...new Set(assets.map((a) => a.equipment_type).filter(Boolean))].sort();
  typeFilter.innerHTML = '<option value="">All types</option>' + equipmentTypes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function renderAssets(assets) {
  if (!assets.length) {
    renderEmpty();
    return;
  }

  assetTbody.innerHTML = assets.map((asset) => {
    const current = Array.isArray(asset.asset_current) ? asset.asset_current[0] : asset.asset_current;
    const assignedTo = current?.people?.display_name || '';
    return `
      <tr data-notes="${escapeHtml(asset.notes || '')}" data-asset-tag="${escapeHtml(asset.asset_tag || '')}" data-serial="${escapeHtml(asset.serial || asset.asset_tag || '')}" data-assignee="${escapeHtml(assignedTo || '')}">
        <td><a href="./asset.html?tag=${encodeURIComponent(asset.asset_tag)}">${escapeHtml(asset.asset_tag || '')}</a></td>
        <td>${escapeHtml(asset.serial || asset.asset_tag || '')}</td>
        <td>${escapeHtml(asset.equipment_type || '')}</td>
        <td>${escapeHtml(asset.model || '')}</td>
        <td>${escapeHtml(assignedTo)}</td>
        <td>${escapeHtml(asset.status || '')}</td>
        <td>${escapeHtml(asset.location || asset.building || '')}</td>
      </tr>
    `;
  }).join('');

  window.enhanceAssetTable?.();
}

async function handleScannerValue(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return;

  const now = Date.now();
  if (raw === lastScanned && now - lastScannedAt < 2000) return;
  lastScanned = raw;
  lastScannedAt = now;

  let tag = raw;
  try {
    const url = new URL(raw);
    const queryTag = url.searchParams.get('tag');
    if (queryTag) {
      tag = queryTag.trim();
    }
  } catch {
    // raw tag, no URL parse needed
  }

  if (!tag) return;
  searchInput.value = tag;
  await loadAssets();
  toast(`Scanned: ${tag}`);
}

async function scanFrame() {
  if (!scannerVideo || scannerVideo.readyState < 2) return;

  if (scannerDetector) {
    const codes = await scannerDetector.detect(scannerVideo);
    if (codes?.length && codes[0].rawValue) {
      await handleScannerValue(codes[0].rawValue);
    }
    return;
  }

  if (!window.jsQR) return;
  const width = scannerVideo.videoWidth || 640;
  const height = scannerVideo.videoHeight || 480;
  scannerCanvas.width = width;
  scannerCanvas.height = height;
  const ctx = scannerCanvas.getContext('2d');
  ctx.drawImage(scannerVideo, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'dontInvert' });
  if (code?.data) {
    await handleScannerValue(code.data);
  }
}

function stopScanner() {
  if (scannerTimer) {
    window.clearInterval(scannerTimer);
    scannerTimer = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach((t) => t.stop());
    scannerStream = null;
  }
  if (scannerVideo) {
    scannerVideo.srcObject = null;
  }
  if (scannerStage) {
    scannerStage.hidden = true;
  }
  if (startScannerBtn) startScannerBtn.disabled = false;
  if (stopScannerBtn) stopScannerBtn.disabled = true;
}

async function startScanner() {
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    scannerVideo.srcObject = scannerStream;
    await scannerVideo.play();

    if ('BarcodeDetector' in window) {
      scannerDetector = new window.BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e']
      });
    } else {
      scannerDetector = null;
    }

    if (scannerStage) scannerStage.hidden = false;
    if (startScannerBtn) startScannerBtn.disabled = true;
    if (stopScannerBtn) stopScannerBtn.disabled = false;

    if (scannerTimer) window.clearInterval(scannerTimer);
    scannerTimer = window.setInterval(() => {
      scanFrame().catch((err) => toast(err.message, true));
    }, 250);
  } catch (err) {
    toast(`Camera error: ${err.message}`, true);
  }
}

async function loadAssets() {
  const term = searchInput.value.trim();
  if (!term) {
    renderSearchPrompt();
    return;
  }

  let query = supabase
    .from('assets')
    .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, location, building, room, asset_condition, ownership, status, notes, asset_current(assignee_person_id, checked_out_at, people(display_name))')
    .order('asset_tag', { ascending: true })
    .limit(200);

  const status = statusFilter.value;
  const equipmentType = typeFilter.value;

  query = query.or(`asset_tag.ilike.%${term}%,serial.ilike.%${term}%,device_name.ilike.%${term}%,manufacturer.ilike.%${term}%,model.ilike.%${term}%,equipment_type.ilike.%${term}%,location.ilike.%${term}%,building.ilike.%${term}%,room.ilike.%${term}%,asset_condition.ilike.%${term}%`);

  if (status) {
    query = query.eq('status', status);
  }
  if (equipmentType) {
    query = query.eq('equipment_type', equipmentType);
  }

  const { data, error } = await query;
  if (error) {
    toast(error.message, true);
    return;
  }
  renderAssets(data || []);
}

function bindSearch() {
  [searchInput, statusFilter, typeFilter].forEach((el) => {
    el.addEventListener('input', () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(loadAssets, 220);
    });
    el.addEventListener('change', loadAssets);
  });
}

async function initAuthedUI(session) {
  authPanel.hidden = true;
  authShell.hidden = true;
  dashboardShell.hidden = false;
  indexTopbar.hidden = false;
  searchPanel.hidden = false;
  mainNav.hidden = false;
  window.scrollTo(0, 0);

  try {
    currentProfile = await getCurrentProfile();
  } catch (err) {
    currentProfile = {
      role: 'viewer',
      display_name: session.user?.email || 'User'
    };
    toast(`Profile lookup failed: ${err.message}`, true);
  }

  setRoleVisibility(currentProfile.role || 'viewer');
  userMeta.textContent = `${currentProfile.display_name || session.user.email} (${currentProfile.role || 'viewer'})`;

  const { data, error } = await supabase
    .from('assets')
    .select('equipment_type')
    .order('equipment_type', { ascending: true })
    .limit(500);

  if (!error && data) {
    fillFilterOptions(data);
  } else if (error) {
    toast(`Asset metadata load failed: ${error.message}`, true);
  }

  renderSearchPrompt();
}

async function init() {
  initTheme();
  bindThemeToggle();
  if (!requireConfig()) {
    authMessage.textContent = 'Update config.js with Supabase URL and anon key.';
    return;
  }

  qs('#sendLinkBtn').addEventListener('click', async () => {
    const email = qs('#emailInput').value.trim();
    if (!email) {
      toast('Enter an email first.', true);
      return;
    }
    try {
      await sendMagicLink(email);
      authMessage.textContent = `Magic link sent to ${email}. Open the email on this device.`;
    } catch (err) {
      toast(err.message, true);
    }
  });
  bindSignOut(signOut, './index.html');

  qs('#refreshBtn').addEventListener('click', loadAssets);
  startScannerBtn?.addEventListener('click', startScanner);
  stopScannerBtn?.addEventListener('click', stopScanner);
  clearFiltersBtn?.addEventListener('click', () => {
    searchInput.value = '';
    statusFilter.value = '';
    typeFilter.value = '';
    renderSearchPrompt();
  });
  bindSearch();

  const session = await getSession();
  if (session) {
    await initAuthedUI(session);
  }

  supabase.auth.onAuthStateChange(async (_event, sessionData) => {
    if (sessionData) {
      await initAuthedUI(sessionData);
    } else {
      authPanel.hidden = false;
      authShell.hidden = false;
      dashboardShell.hidden = true;
      indexTopbar.hidden = true;
      searchPanel.hidden = true;
      mainNav.hidden = true;
      assetTbody.innerHTML = '';
      stopScanner();
    }
  });

  window.addEventListener('beforeunload', stopScanner);
}

init().catch((err) => {
  toast(err.message, true);
});

