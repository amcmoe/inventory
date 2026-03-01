import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, sendMagicLink, signOut, ensureSessionFresh, startSessionKeepAlive } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav } from './ui.js';

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
const searchField = qs('#searchField');
const statusFilter = qs('#statusFilter');
const clearFiltersBtn = qs('#clearFiltersBtn');
const scannerToggleBtn = qs('#scannerToggleBtn');
const scannerStage = qs('#scannerStage');
const scannerVideo = qs('#scannerVideo');
const scannerCanvas = qs('#scannerCanvas');
const remoteScanBtn = qs('#remoteScanBtn');
const pairModalOverlay = qs('#pairModalOverlay');
const pairModal = qs('#pairModal');
const pairModalCloseBtn = qs('#pairModalCloseBtn');
const pairQrCanvas = qs('#pairQrCanvas');
const pairStatus = qs('#pairStatus');
const pairMeta = qs('#pairMeta');
const pairRegenerateBtn = qs('#pairRegenerateBtn');
const pairEndSessionBtn = qs('#pairEndSessionBtn');
const remoteBadge = qs('#remoteBadge');
const pendingUploadsBadge = qs('#pendingUploadsBadge');
const drawerOverlay = qs('#drawerOverlay');
const closeDrawerBtn = qs('#closeDrawerBtn');
const drawerAssigneeEditor = qs('#drawerAssigneeEditor');
const drawerAssigneeSearch = qs('#drawerAssigneeSearch');
const drawerAssigneeSuggestions = qs('#drawerAssigneeSuggestions');
const drawerAssigneeSelected = qs('#drawerAssigneeSelected');
const drawerSetAssigneeBtn = qs('#drawerSetAssigneeBtn');
const drawerCreatePersonBtn = qs('#drawerCreatePersonBtn');
const drawerNotes = qs('#drawerNotes');
const drawerNoteEditor = qs('#drawerNoteEditor');
const drawerNoteInput = qs('#drawerNoteInput');
const drawerSaveNoteBtn = qs('#drawerSaveNoteBtn');
const drawerDamageEditor = qs('#drawerDamageEditor');
const drawerOpenDamageBtn = qs('#drawerOpenDamageBtn');
const damageDrawer = qs('#damageDrawer');
const damageDrawerCloseBtn = qs('#damageDrawerCloseBtn');
const damageDrawerCancelBtn = qs('#damageDrawerCancelBtn');
const damageDrawerAssetMeta = qs('#damageDrawerAssetMeta');
const drawerDamageNotes = qs('#drawerDamageNotes');
const drawerDamagePhotos = qs('#drawerDamagePhotos');
const drawerDamageUploadBtn = qs('#drawerDamageUploadBtn');
const drawerDamageCameraToggleBtn = qs('#drawerDamageCameraToggleBtn');
const drawerDamageCameraCaptureBtn = qs('#drawerDamageCameraCaptureBtn');
const drawerDamageCameraStage = qs('#drawerDamageCameraStage');
const drawerDamageCameraVideo = qs('#drawerDamageCameraVideo');
const drawerDamageCameraCanvas = qs('#drawerDamageCameraCanvas');
const drawerDamageThumbs = qs('#drawerDamageThumbs');
const drawerReportDamageBtn = qs('#drawerReportDamageBtn');
const damagePhotoBucket = 'asset-damage-photos';

let currentProfile = null;
let debounceTimer = null;
let scannerStream = null;
let scannerTimer = null;
let scannerDetector = null;
let lastScanned = '';
let lastScannedAt = 0;
let scannerRunning = false;
let autoRefreshTimer = null;
let autoRefreshCount = 0;
const AUTO_REFRESH_MS = 2 * 60 * 1000;
const AUTO_REFRESH_MAX = 20;
let selectedAsset = null;
let selectedPerson = null;
let personSearchDebounce = null;
let remotePairingId = null;
let remoteSessionId = null;
let remoteSessionExpiresAt = null;
let pairingGenerateInFlight = false;
let remotePairPollTimer = null;
let remoteExpireTimer = null;
let remoteChannel = null;
let remoteStatusTimer = null;
let remoteDamagePollTimer = null;
const seenRemoteDamageEventIds = new Set();
let remoteStatusFailureCount = 0;
let stopSessionKeepAlive = null;
const REMOTE_SESSION_KEY = 'remoteScanSession';
const DISMISSED_REMOTE_DAMAGE_KEY_PREFIX = 'remoteDismissedDamagePaths:';
let drawerDamageCameraStream = null;
let capturedDamagePhotos = [];
let expandedDamagePhotoId = null;
const damageDraftsByAssetId = new Map();
let remoteModeSyncTimer = null;
let pendingRemoteDamagePhotos = [];
const PENDING_REMOTE_DAMAGE_TTL_MS = 10 * 60 * 1000;
let pendingRemotePurgeTimer = null;
let remoteSessionWatchdogTimer = null;
const dismissedRemoteDamagePaths = new Set();

function getDismissedRemoteDamageStorageKey(sessionId = remoteSessionId) {
  const id = String(sessionId || '').trim();
  return id ? `${DISMISSED_REMOTE_DAMAGE_KEY_PREFIX}${id}` : '';
}

function loadDismissedRemoteDamagePaths() {
  dismissedRemoteDamagePaths.clear();
  const key = getDismissedRemoteDamageStorageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed.forEach((item) => {
      const path = String(item || '').trim();
      if (path) dismissedRemoteDamagePaths.add(path);
    });
  } catch {
    // ignore malformed storage payload
  }
}

function persistDismissedRemoteDamagePaths() {
  const key = getDismissedRemoteDamageStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(dismissedRemoteDamagePaths).slice(-400)));
  } catch {
    // ignore storage write failures
  }
}

function isRemoteDamagePathDismissed(path) {
  const value = String(path || '').trim();
  return value ? dismissedRemoteDamagePaths.has(value) : false;
}

function removePendingRemoteDamagePath(path) {
  const value = String(path || '').trim();
  if (!value) return;
  pendingRemoteDamagePhotos = pendingRemoteDamagePhotos.filter((item) => String(item?.path || '').trim() !== value);
  updatePendingUploadsBadge();
}

function getScanSessionIdFromRemotePath(path) {
  const value = String(path || '').trim();
  if (!value) return '';
  const parts = value.split('/').filter(Boolean);
  if (parts.length < 3) return '';
  if (parts[0] !== 'remote-temp') return '';
  return String(parts[1] || '').trim();
}

async function dismissAndDeleteRemoteDamagePath(path) {
  const value = String(path || '').trim();
  if (!value) return;
  dismissedRemoteDamagePaths.add(value);
  persistDismissedRemoteDamagePaths();
  removePendingRemoteDamagePath(value);
  const sessionId = String(remoteSessionId || getScanSessionIdFromRemotePath(value)).trim();
  try {
    const { error } = await supabase.functions.invoke('scan-damage-delete', {
      body: {
        scan_session_id: sessionId || null,
        path: value
      }
    });
    if (error) {
      throw new Error(error.message || 'Failed to delete temp remote photo');
    }
    return;
  } catch (err) {
    // Fall back to best-effort local client calls for older deployments.
    toast((err && err.message) ? err.message : 'Temp delete function unavailable; using fallback delete.', true);
  }
  try {
    await supabase.storage.from(damagePhotoBucket).remove([value]);
  } catch {
    // keep dismissed even if storage delete fails
  }
  if (sessionId) {
    try {
      await supabase
        .from('scan_events')
        .delete()
        .eq('scan_session_id', sessionId)
        .eq('source', 'remote_damage_photo')
        .ilike('barcode', `%${value}%`);
    } catch {
      // ignore delete-policy issues; dismissed set still prevents re-add
    }
  }
}

function getPendingUploadCount() {
  let count = pendingRemoteDamagePhotos.length;
  damageDraftsByAssetId.forEach((draft) => {
    count += Array.isArray(draft?.photos) ? draft.photos.length : 0;
  });
  return count;
}

function updatePendingUploadsBadge() {
  if (!pendingUploadsBadge) return;
  const count = getPendingUploadCount();
  const hasPending = count > 0;
  pendingUploadsBadge.hidden = !hasPending;
  pendingUploadsBadge.classList.toggle('is-pending', hasPending);
  pendingUploadsBadge.textContent = `Pending Uploads: ${count}`;
  const target = hasPending ? getFirstPendingUploadTarget() : null;
  if (!hasPending) {
    pendingUploadsBadge.removeAttribute('title');
    pendingUploadsBadge.removeAttribute('aria-label');
    return;
  }
  const tag = String(target?.assetTag || '').trim();
  const hint = tag
    ? `Open pending uploads for ${tag}`
    : 'Open pending uploads';
  pendingUploadsBadge.title = hint;
  pendingUploadsBadge.setAttribute('aria-label', hint);
}

function getFirstPendingUploadTarget() {
  for (const [assetId, draft] of damageDraftsByAssetId.entries()) {
    const photoCount = Array.isArray(draft?.photos) ? draft.photos.length : 0;
    const note = String(draft?.notes || '').trim();
    if (photoCount > 0 || note) {
      return { assetId: String(assetId), assetTag: '' };
    }
  }
  const remoteTagged = pendingRemoteDamagePhotos.find((item) => String(item?.assetTag || '').trim());
  if (remoteTagged) {
    return { assetId: '', assetTag: String(remoteTagged.assetTag || '').trim() };
  }
  const remoteAny = pendingRemoteDamagePhotos[0];
  if (remoteAny) {
    return { assetId: '', assetTag: String(remoteAny.assetTag || '').trim() };
  }
  return null;
}

function findAssetRowForPendingTarget(target) {
  if (!assetTbody || !target) return null;
  const rows = Array.from(assetTbody.querySelectorAll('tr[data-asset-id], tr[data-asset-tag]'));
  if (target.assetId) {
    const byId = rows.find((row) => String(row.dataset.assetId || '') === String(target.assetId));
    if (byId) return byId;
  }
  if (target.assetTag) {
    const wanted = String(target.assetTag || '').toLowerCase();
    const byTag = rows.find((row) => String(row.dataset.assetTag || '').toLowerCase() === wanted);
    if (byTag) return byTag;
  }
  return null;
}

function openPendingTargetRow(row) {
  if (!row) return;
  try {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    row.scrollIntoView();
  }
  const damageBtn = row.querySelector('.row-record-damage-btn');
  if (damageBtn) {
    damageBtn.click();
    return;
  }
  row.click();
  window.setTimeout(() => {
    openDamageDrawerForSelectedAsset();
  }, 30);
}

async function jumpToPendingUploads() {
  const target = getFirstPendingUploadTarget();
  if (!target) return;
  let row = findAssetRowForPendingTarget(target);
  if (!row && target.assetTag) {
    searchInput.value = target.assetTag;
    await loadAssets();
    row = findAssetRowForPendingTarget(target);
  }
  if (!row) {
    toast('Pending uploads exist, but matching asset is not in the current results.', true);
    return;
  }
  openPendingTargetRow(row);
}

function syncScannerToggleButton() {
  if (!scannerToggleBtn) return;
  scannerToggleBtn.classList.toggle('is-running', scannerRunning);
  scannerToggleBtn.setAttribute('aria-label', scannerRunning ? 'Stop scanner' : 'Start scanner');
  scannerToggleBtn.title = scannerRunning ? 'Stop' : 'QR Scanner';
}

async function toggleScanner() {
  if (scannerRunning) {
    stopScanner();
    return;
  }
  await startScanner();
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshCount = 0;
  autoRefreshTimer = window.setInterval(async () => {
    if (document.hidden) return;
    if (autoRefreshCount >= AUTO_REFRESH_MAX) {
      stopAutoRefresh();
      toast('Auto-refresh paused (session cap reached).');
      return;
    }
    if (!searchInput.value.trim()) return;
    autoRefreshCount += 1;
    await loadAssets();
  }, AUTO_REFRESH_MS);
}

function renderSearchPrompt() {
  assetTbody.innerHTML = '<tr><td colspan="6" class="dim">Type a serial or model to search for assets.</td></tr>';
  window.updateKpisFromTable?.();
}

function renderEmpty() {
  assetTbody.innerHTML = '<tr><td colspan="6" class="dim">No assets found for the current filters.</td></tr>';
  window.updateKpisFromTable?.();
}

function renderAssets(assets) {
  if (!assets.length) {
    renderEmpty();
    return;
  }

  assetTbody.innerHTML = assets.map((asset) => {
    const current = Array.isArray(asset.asset_current) ? asset.asset_current[0] : asset.asset_current;
    const assignedTo = current?.people?.display_name || '';
    const serial = asset.serial || asset.asset_tag || '';
    const lookupTag = asset.asset_tag || serial;
    const buildingLabel = asset.building || '';
    const canWrite = Boolean(currentProfile && (currentProfile.role === 'admin' || currentProfile.role === 'tech'));
    return `
      <tr data-notes="${escapeHtml(asset.notes || '')}" data-asset-id="${escapeHtml(asset.id || '')}" data-asset-tag="${escapeHtml(lookupTag)}" data-serial="${escapeHtml(serial)}" data-model="${escapeHtml(asset.model || '')}" data-manufacturer="${escapeHtml(asset.manufacturer || '')}" data-equipment-type="${escapeHtml(asset.equipment_type || '')}" data-assignee="${escapeHtml(assignedTo || '')}" data-status="${escapeHtml(asset.status || '')}" data-building="${escapeHtml(asset.building || '')}" data-room="${escapeHtml(asset.room || '')}" data-service-start-date="${escapeHtml(asset.service_start_date || '')}" data-ownership="${escapeHtml(asset.ownership || '')}" data-warranty-expiration-date="${escapeHtml(asset.warranty_expiration_date || '')}" data-obsolete="${asset.obsolete ? 'Yes' : 'No'}">
        <td>${escapeHtml(serial)}</td>
        <td>${escapeHtml(asset.model || '')}</td>
        <td>${escapeHtml(assignedTo)}</td>
        <td>${escapeHtml(asset.status || '')}</td>
        <td>${escapeHtml(buildingLabel)}</td>
        <td>${canWrite ? `<button class="btn danger row-record-damage-btn" type="button">Record Damage</button>` : ''}</td>
      </tr>
    `;
  }).join('');

  window.enhanceAssetTable?.();
  bindRowDamageButtons();
}

function bindRowDamageButtons() {
  assetTbody.querySelectorAll('.row-record-damage-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tr = btn.closest('tr');
      if (!tr) return;
      tr.click();
      window.setTimeout(() => {
        openDamageDrawerForSelectedAsset();
      }, 20);
    });
  });
}

function sanitizeFilterTerm(term) {
  return String(term || '')
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  if (searchField) {
    searchField.classList.remove('scanner-active');
  }
  if (searchPanel) {
    searchPanel.classList.remove('scanner-open');
  }
  scannerRunning = false;
  syncScannerToggleButton();
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
    if (searchField) {
      searchField.classList.add('scanner-active');
    }
    if (searchPanel) {
      searchPanel.classList.add('scanner-open');
    }
    scannerRunning = true;
    syncScannerToggleButton();

    if (scannerTimer) window.clearInterval(scannerTimer);
    scannerTimer = window.setInterval(() => {
      scanFrame().catch((err) => toast(err.message, true));
    }, 250);
  } catch (err) {
    scannerRunning = false;
    syncScannerToggleButton();
    toast(`Camera error: ${err.message}`, true);
  }
}

async function loadAssets() {
  await ensureSessionFresh();
  const term = sanitizeFilterTerm(searchInput.value);
  if (!term) {
    renderSearchPrompt();
    return;
  }

  let query = supabase
    .from('assets')
    .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, building, room, service_start_date, ownership, warranty_expiration_date, obsolete, status, notes, asset_current(assignee_person_id, checked_out_at, people(display_name))')
    .order('asset_tag', { ascending: true })
    .limit(200);

  const status = statusFilter.value;

  query = query.or(`asset_tag.ilike.%${term}%,serial.ilike.%${term}%,device_name.ilike.%${term}%,manufacturer.ilike.%${term}%,model.ilike.%${term}%,equipment_type.ilike.%${term}%,building.ilike.%${term}%,room.ilike.%${term}%,asset_condition.ilike.%${term}%`);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    toast(error.message, true);
    return;
  }

  // Secondary assignee-name search path (kept separate to avoid PostgREST logic-tree parsing issues).
  const { data: assigneeRows, error: assigneeError } = await supabase
    .from('asset_current')
    .select('asset_id, people!inner(display_name)')
    .ilike('people.display_name', `%${term}%`)
    .limit(200);

  if (assigneeError) {
    toast(assigneeError.message, true);
    return;
  }

  const assigneeAssetIds = [...new Set((assigneeRows || []).map((r) => r.asset_id).filter(Boolean))];
  let assigneeAssets = [];
  if (assigneeAssetIds.length) {
    let assigneeQuery = supabase
      .from('assets')
      .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, building, room, service_start_date, ownership, warranty_expiration_date, obsolete, status, notes, asset_current(assignee_person_id, checked_out_at, people(display_name))')
      .in('id', assigneeAssetIds)
      .order('asset_tag', { ascending: true })
      .limit(200);
    if (status) {
      assigneeQuery = assigneeQuery.eq('status', status);
    }
    const { data: assigneeAssetData, error: assigneeAssetError } = await assigneeQuery;
    if (assigneeAssetError) {
      toast(assigneeAssetError.message, true);
      return;
    }
    assigneeAssets = assigneeAssetData || [];
  }

  const merged = new Map();
  [...(data || []), ...assigneeAssets].forEach((asset) => {
    if (asset?.id) merged.set(asset.id, asset);
  });

  renderAssets(Array.from(merged.values()));
}

function bindSearch() {
  [searchInput, statusFilter].forEach((el) => {
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
  initAdminNav();
  userMeta.textContent = `${currentProfile.display_name || session.user.email} (${currentProfile.role || 'viewer'})`;

  renderSearchPrompt();
  startAutoRefresh();
}

async function searchPeople(term) {
  if (!drawerAssigneeSuggestions) return;
  if (drawerCreatePersonBtn) drawerCreatePersonBtn.hidden = true;
  if (!term || term.length < 2) {
    drawerAssigneeSuggestions.hidden = true;
    return;
  }
  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, email, employee_id')
    .ilike('display_name', `%${term}%`)
    .order('display_name', { ascending: true })
    .limit(8);
  if (error) {
    toast(error.message, true);
    return;
  }
  if (!data?.length) {
    drawerAssigneeSuggestions.innerHTML = '<div class="suggestion muted">No match found.</div>';
    drawerAssigneeSuggestions.hidden = false;
    if (drawerCreatePersonBtn && currentProfile?.role === 'admin') {
      drawerCreatePersonBtn.hidden = false;
    }
    return;
  }
  drawerAssigneeSuggestions.innerHTML = data.map((person) => `
    <div class="suggestion" data-person-id="${person.id}">
      <strong>${escapeHtml(person.display_name)}</strong><br>
      <span class="muted">${escapeHtml(person.email || person.employee_id || '-')}</span>
    </div>
  `).join('');
  drawerAssigneeSuggestions.hidden = false;
  drawerAssigneeSuggestions.querySelectorAll('.suggestion[data-person-id]').forEach((node) => {
    node.addEventListener('click', () => {
      const person = data.find((p) => p.id === node.getAttribute('data-person-id'));
      if (!person) return;
      selectedPerson = person;
      drawerAssigneeSearch.value = person.display_name;
      drawerAssigneeSelected.textContent = `Selected: ${person.display_name}`;
      drawerAssigneeSuggestions.hidden = true;
    });
  });
}

async function createPersonFromDrawer() {
  if (currentProfile?.role !== 'admin') {
    toast('Admin role required.', true);
    return;
  }
  const displayNameSeed = drawerAssigneeSearch?.value.trim() || '';
  const name = window.prompt('New person display name:', displayNameSeed);
  if (!name) return;
  const email = window.prompt('Email (optional):') || null;
  const employeeId = window.prompt('Employee ID (optional):') || null;
  const department = window.prompt('Department (optional):') || null;

  const { data, error } = await supabase.rpc('admin_create_person', {
    p_display_name: name,
    p_email: email,
    p_employee_id: employeeId,
    p_department: department
  });
  if (error) {
    toast(error.message, true);
    return;
  }

  selectedPerson = data;
  if (drawerAssigneeSearch) drawerAssigneeSearch.value = data.display_name || name;
  if (drawerAssigneeSelected) drawerAssigneeSelected.textContent = `Selected: ${data.display_name || name}`;
  if (drawerAssigneeSuggestions) drawerAssigneeSuggestions.hidden = true;
  if (drawerCreatePersonBtn) drawerCreatePersonBtn.hidden = true;
  toast('Person created.');
}

async function setAssigneeFromDrawer() {
  if (!selectedAsset?.assetTag) {
    toast('Select an asset first.', true);
    return;
  }
  if (!selectedPerson?.id) {
    toast('Select an assignee first.', true);
    return;
  }
  if (selectedAsset.status === 'checked_out') {
    const { error: checkinError } = await supabase.rpc('checkin_asset', {
      p_asset_tag: selectedAsset.assetTag,
      p_notes: 'Reassigned from search drawer'
    });
    if (checkinError) {
      toast(checkinError.message, true);
      return;
    }
  }
  const { error: checkoutError } = await supabase.rpc('checkout_asset', {
    p_asset_tag: selectedAsset.assetTag,
    p_assignee_person_id: selectedPerson.id,
    p_due_date: null,
    p_notes: 'Assigned from search drawer'
  });
  if (checkoutError) {
    toast(checkoutError.message, true);
    return;
  }
  toast('Assignee updated.');
  await loadAssets();
}

async function saveAssetNoteFromDrawer() {
  if (!selectedAsset?.assetTag) {
    toast('Select an asset first.', true);
    return;
  }
  const note = (drawerNoteInput?.value || '').trim();
  if (!note) {
    toast('Enter a note first.', true);
    return;
  }
  const { data, error } = await supabase.rpc('append_asset_note', {
    p_asset_tag: selectedAsset.assetTag,
    p_note: note
  });
  if (error) {
    toast(error.message, true);
    return;
  }
  drawerNoteInput.value = '';
  if (drawerNotes) {
    drawerNotes.textContent = data?.notes || selectedAsset.notes || '-';
  }
  selectedAsset.notes = data?.notes || selectedAsset.notes || '';
  toast('Note saved.');
  await loadAssets();
}

async function submitDamageFromDrawer() {
  if (!selectedAsset?.assetId) {
    toast('Select an asset first.', true);
    return;
  }
  const noteText = (drawerDamageNotes?.value || '').trim();
  const notes = noteText || null;
  const summary = noteText ? noteText.slice(0, 120) : '';
  const files = Array.from(drawerDamagePhotos?.files || []);
  const capturedFiles = capturedDamagePhotos.map((item) => item.file);
  const allFiles = [...capturedFiles, ...files];
  if (!noteText) {
    toast('Damage note is required.', true);
    return;
  }

  let relatedTransactionId = null;
  const { data: currentRow } = await supabase
    .from('asset_current')
    .select('last_transaction_id')
    .eq('asset_id', selectedAsset.assetId)
    .maybeSingle();
  relatedTransactionId = currentRow?.last_transaction_id || null;

  const { data: report, error } = await supabase
    .from('damage_reports')
    .insert({
      asset_id: selectedAsset.assetId,
      summary,
      notes,
      related_transaction_id: relatedTransactionId
    })
    .select('id')
    .single();
  if (error) {
    toast(error.message, true);
    return;
  }

  function sanitizeFilename(name) {
    return String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  for (const file of allFiles) {
    const path = `${report.id}/${Date.now()}-${Math.random().toString(36).slice(2)}-${sanitizeFilename(file.name)}`;
    const upload = await supabase.storage.from(damagePhotoBucket).upload(path, file);
    if (upload.error) {
      toast(`Photo upload failed: ${upload.error.message}`, true);
      continue;
    }
    const insertPhoto = await supabase
      .from('damage_photos')
      .insert({
        damage_report_id: report.id,
        storage_path: path
      });
    if (insertPhoto.error) {
      toast(`Photo record failed: ${insertPhoto.error.message}`, true);
    }
  }

  capturedDamagePhotos.forEach((p) => {
    if (p?.url) URL.revokeObjectURL(p.url);
  });
  drawerDamageNotes.value = '';
  if (drawerDamagePhotos) drawerDamagePhotos.value = '';
  capturedDamagePhotos = [];
  expandedDamagePhotoId = null;
  if (selectedAsset?.assetId) {
    damageDraftsByAssetId.delete(selectedAsset.assetId);
  }
  renderCapturedDamageThumbs();
  updatePendingUploadsBadge();
  stopDrawerDamageCamera();
  setDamageDrawerOpen(false);
  toast('Damage report submitted.');
}

async function syncRemoteDamageMode(mode = 'scan', assetTag = null) {
  if (!remoteSessionId) return;
  await ensureSessionFresh();
  const normalizedMode = mode === 'damage' ? 'damage' : 'scan';
  const normalizedAssetTag = normalizedMode === 'damage'
    ? String(assetTag || selectedAsset?.assetTag || '').trim()
    : null;
  const { error } = await supabase.functions.invoke('scan-session-control', {
    body: {
      scan_session_id: remoteSessionId,
      mode: normalizedMode,
      asset_tag: normalizedAssetTag || null
    }
  });
  if (error) {
    throw new Error(error.message || 'Failed to update remote scanner mode');
  }
}

function queueRemoteDamageModeSync(mode = 'scan', assetTag = null) {
  if (!remoteSessionId) return;
  if (remoteModeSyncTimer) {
    window.clearTimeout(remoteModeSyncTimer);
  }
  remoteModeSyncTimer = window.setTimeout(() => {
    remoteModeSyncTimer = null;
    syncRemoteDamageMode(mode, assetTag)
      .then(() => {
        if (!remoteSessionId) return;
        const damageOpen = Boolean(mode === 'damage');
        setRemoteBadge('on', damageOpen ? 'Remote Scanner: Damage Mode' : 'Remote Scanner: Connected');
      })
      .catch((err) => {
        if (!remoteSessionId) return;
        // Retry once for transient control-function lag.
        window.setTimeout(() => {
          if (!remoteSessionId) return;
          syncRemoteDamageMode(mode, assetTag)
            .then(() => {
              const damageOpen = Boolean(mode === 'damage');
              setRemoteBadge('on', damageOpen ? 'Remote Scanner: Damage Mode' : 'Remote Scanner: Connected');
            })
            .catch(() => {
              setRemoteBadge('on', 'Remote Scanner: Connected');
              toast(`Remote mode sync failed: ${err.message}`, true);
            });
        }, 240);
      });
  }, 90);
}

function setDamageDrawerOpen(open) {
  if (!damageDrawer) return;
  damageDrawer.classList.toggle('open', Boolean(open));
  damageDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (remoteSessionId) {
    if (open && selectedAsset?.assetTag) {
      queueRemoteDamageModeSync('damage', selectedAsset.assetTag);
    } else {
      queueRemoteDamageModeSync('scan', null);
    }
  }
  if (!open) {
    stopDrawerDamageCamera();
  }
}

function setDrawerCameraButtons() {
  const running = Boolean(drawerDamageCameraStream);
  if (drawerDamageCameraToggleBtn) {
    drawerDamageCameraToggleBtn.classList.toggle('is-running', running);
    drawerDamageCameraToggleBtn.setAttribute('aria-label', running ? 'Stop camera' : 'Start camera');
    drawerDamageCameraToggleBtn.title = running ? 'Stop Camera' : 'Start Camera';
  }
  if (drawerDamageCameraCaptureBtn) drawerDamageCameraCaptureBtn.disabled = !running;
}

function renderCapturedDamageThumbs() {
  if (!drawerDamageThumbs) return;
  if (!capturedDamagePhotos.length) {
    expandedDamagePhotoId = null;
    drawerDamageThumbs.hidden = true;
    drawerDamageThumbs.innerHTML = '';
    saveDamageDraftForCurrentAsset();
    return;
  }
  if (expandedDamagePhotoId && !capturedDamagePhotos.some((p) => p.id === expandedDamagePhotoId)) {
    expandedDamagePhotoId = null;
  }
  drawerDamageThumbs.hidden = false;
  drawerDamageThumbs.innerHTML = capturedDamagePhotos.map((p) => `
    <button class="thumb-item ${expandedDamagePhotoId === p.id ? 'is-expanded' : ''}" type="button" data-photo-id="${escapeHtml(p.id)}" aria-label="Toggle photo preview">
      <img src="${escapeHtml(p.url)}" alt="Damage capture">
      <span class="thumb-expand-hint">${expandedDamagePhotoId === p.id ? 'Collapse' : 'Expand'}</span>
      <span class="thumb-remove" data-remove-photo-id="${escapeHtml(p.id)}" role="button" tabindex="0" aria-label="Remove photo">X</span>
    </button>
  `).join('');
  drawerDamageThumbs.querySelectorAll('.thumb-item[data-photo-id]').forEach((item) => {
    item.addEventListener('click', (event) => {
      const removeTarget = event.target?.closest?.('[data-remove-photo-id]');
      if (removeTarget) return;
      const id = item.getAttribute('data-photo-id');
      expandedDamagePhotoId = expandedDamagePhotoId === id ? null : id;
      renderCapturedDamageThumbs();
    });
  });
  drawerDamageThumbs.querySelectorAll('.thumb-remove[data-remove-photo-id]').forEach((btn) => {
    const remove = async () => {
      const id = btn.getAttribute('data-remove-photo-id');
      const idx = capturedDamagePhotos.findIndex((p) => p.id === id);
      if (idx >= 0) {
        const removed = capturedDamagePhotos[idx];
        URL.revokeObjectURL(removed.url);
        capturedDamagePhotos.splice(idx, 1);
        renderCapturedDamageThumbs();
        if (removed?.remotePath) {
          await dismissAndDeleteRemoteDamagePath(removed.remotePath);
        }
      }
    };
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      remove().catch(() => {});
    });
    btn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        remove().catch(() => {});
      }
    });
  });
  saveDamageDraftForCurrentAsset();
}

function saveDamageDraftForCurrentAsset() {
  const assetId = String(selectedAsset?.assetId || '').trim();
  if (!assetId) return;
  const notes = String(drawerDamageNotes?.value || '');
  if (!notes.trim() && !capturedDamagePhotos.length) {
    damageDraftsByAssetId.delete(assetId);
    updatePendingUploadsBadge();
    return;
  }
  damageDraftsByAssetId.set(assetId, {
    notes,
    photos: capturedDamagePhotos.slice(),
    expandedPhotoId: expandedDamagePhotoId || null
  });
  updatePendingUploadsBadge();
}

function restoreDamageDraftForAsset(assetId) {
  const id = String(assetId || '').trim();
  const draft = id ? damageDraftsByAssetId.get(id) : null;
  if (drawerDamageNotes) drawerDamageNotes.value = draft?.notes || '';
  if (drawerDamagePhotos) drawerDamagePhotos.value = '';
  capturedDamagePhotos = Array.isArray(draft?.photos) ? draft.photos.slice() : [];
  expandedDamagePhotoId = draft?.expandedPhotoId || null;
  renderCapturedDamageThumbs();
  updatePendingUploadsBadge();
}

function clearAllDamageDrafts() {
  const seen = new Set();
  damageDraftsByAssetId.forEach((draft) => {
    const photos = Array.isArray(draft?.photos) ? draft.photos : [];
    photos.forEach((p) => {
      const url = String(p?.url || '');
      if (!url || seen.has(url)) return;
      seen.add(url);
      URL.revokeObjectURL(url);
    });
  });
  capturedDamagePhotos.forEach((p) => {
    const url = String(p?.url || '');
    if (!url || seen.has(url)) return;
    seen.add(url);
    URL.revokeObjectURL(url);
  });
  damageDraftsByAssetId.clear();
  if (drawerDamageNotes) drawerDamageNotes.value = '';
  if (drawerDamagePhotos) drawerDamagePhotos.value = '';
  selectedAsset = null;
  capturedDamagePhotos = [];
  expandedDamagePhotoId = null;
  renderCapturedDamageThumbs();
  updatePendingUploadsBadge();
}

async function startDrawerDamageCamera() {
  if (drawerDamageCameraStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    drawerDamageCameraStream = stream;
    if (drawerDamageCameraVideo) {
      drawerDamageCameraVideo.srcObject = stream;
      await drawerDamageCameraVideo.play();
    }
    if (drawerDamageCameraStage) drawerDamageCameraStage.hidden = false;
    setDrawerCameraButtons();
  } catch (err) {
    toast(`Camera error: ${err.message}`, true);
  }
}

function stopDrawerDamageCamera() {
  if (drawerDamageCameraStream) {
    drawerDamageCameraStream.getTracks().forEach((t) => t.stop());
    drawerDamageCameraStream = null;
  }
  if (drawerDamageCameraVideo) drawerDamageCameraVideo.srcObject = null;
  if (drawerDamageCameraStage) drawerDamageCameraStage.hidden = true;
  setDrawerCameraButtons();
}

async function toggleDrawerDamageCamera() {
  if (drawerDamageCameraStream) {
    stopDrawerDamageCamera();
    return;
  }
  await startDrawerDamageCamera();
}

async function captureDrawerDamagePhoto() {
  if (!drawerDamageCameraVideo || !drawerDamageCameraCanvas || !drawerDamageCameraStream) return;
  const width = drawerDamageCameraVideo.videoWidth || 1280;
  const height = drawerDamageCameraVideo.videoHeight || 720;
  drawerDamageCameraCanvas.width = width;
  drawerDamageCameraCanvas.height = height;
  const ctx = drawerDamageCameraCanvas.getContext('2d');
  ctx.drawImage(drawerDamageCameraVideo, 0, 0, width, height);
  const blob = await new Promise((resolve) => drawerDamageCameraCanvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) {
    toast('Capture failed.', true);
    return;
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filename = `capture-${Date.now()}.jpg`;
  const file = new File([blob], filename, { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  capturedDamagePhotos.push({ id, file, url });
  renderCapturedDamageThumbs();
  toast('Photo captured.');
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
  if (remoteModeSyncTimer) {
    window.clearTimeout(remoteModeSyncTimer);
    remoteModeSyncTimer = null;
  }
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
  if (remoteDamagePollTimer) {
    window.clearInterval(remoteDamagePollTimer);
    remoteDamagePollTimer = null;
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
  if (remoteScanBtn) {
    remoteScanBtn.classList.remove('is-disconnecting');
    const isConnected = state === 'on';
    remoteScanBtn.classList.toggle('is-connected', isConnected);
    remoteScanBtn.setAttribute('aria-label', isConnected ? 'Disconnect phone scanner' : 'Pair phone scanner');
    remoteScanBtn.title = isConnected ? 'Disconnect Phone Scanner' : 'Pair Phone Scanner';
  }
}

async function clearRemoteSessionLocal(reasonText = 'Session ended.') {
  const previousSessionId = remoteSessionId;
  remoteSessionId = null;
  remoteSessionExpiresAt = null;
  remoteStatusFailureCount = 0;
  dismissedRemoteDamagePaths.clear();
  if (previousSessionId) {
    const key = getDismissedRemoteDamageStorageKey(previousSessionId);
    if (key) localStorage.removeItem(key);
  }
  clearPersistedRemoteSession();
  await stopRemoteSubscription();
  setRemoteBadge('off', 'Remote Scanner: Idle');
  pairStatus.textContent = reasonText;
  pairMeta.textContent = '';
  clearRemoteTimers();
}

function flashRemoteBadge() {
  if (!remoteBadge) return;
  remoteBadge.classList.remove('flash');
  // Force reflow so repeated connects retrigger animation.
  void remoteBadge.offsetWidth;
  remoteBadge.classList.add('flash');
}

async function syncRemoteSessionState() {
  if (!remoteSessionId) return;
  try {
    const { data, error } = await supabase.functions.invoke('scan-session-status', {
      body: { scan_session_id: remoteSessionId }
    });
    if (error || !data) {
      remoteStatusFailureCount += 1;
      if (remoteStatusFailureCount >= 3) {
        await clearRemoteSessionLocal('Session unavailable.');
      }
      return;
    }
    remoteStatusFailureCount = 0;
    if (data.status !== 'active') {
      await clearRemoteSessionLocal('Session ended.');
      return;
    }
    remoteSessionExpiresAt = data.expires_at;
  } catch {
    remoteStatusFailureCount += 1;
    if (remoteStatusFailureCount >= 3) {
      await clearRemoteSessionLocal('Session unavailable.');
    }
  }
}

function startRemoteStatusMonitor() {
  if (!remoteSessionId) return;
  syncRemoteSessionState().catch(() => {});
  if (remoteStatusTimer) window.clearInterval(remoteStatusTimer);
  remoteStatusTimer = window.setInterval(() => {
    syncRemoteSessionState().catch(() => {});
  }, 1500);
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

function extractRemoteDamagePath(payload) {
  const raw = String(payload?.barcode || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type !== 'damage_photo') return null;
    const path = String(parsed.path || '').trim();
    if (!path) return null;
    const assetTag = String(parsed.asset_tag || '').trim();
    return { path, assetTag, receivedAt: Date.now() };
  } catch {
    return null;
  }
}

function purgeStalePendingRemoteDamagePhotos() {
  const cutoff = Date.now() - PENDING_REMOTE_DAMAGE_TTL_MS;
  pendingRemoteDamagePhotos = pendingRemoteDamagePhotos.filter((item) => {
    const at = Number(item?.receivedAt || 0);
    return at > cutoff;
  });
  updatePendingUploadsBadge();
}

function startPendingRemoteDamagePurgeTicker() {
  if (pendingRemotePurgeTimer) window.clearInterval(pendingRemotePurgeTimer);
  pendingRemotePurgeTimer = window.setInterval(() => {
    purgeStalePendingRemoteDamagePhotos();
  }, 60 * 1000);
}

function startRemoteSessionWatchdog() {
  if (remoteSessionWatchdogTimer) window.clearInterval(remoteSessionWatchdogTimer);
  remoteSessionWatchdogTimer = window.setInterval(() => {
    if (!remoteSessionId) return;
    syncRemoteSessionState().catch(() => {});
  }, 2000);
}

async function addRemoteDamagePhotoToDrawer(path) {
  if (isRemoteDamagePathDismissed(path)) return;
  const duplicate = capturedDamagePhotos.some((p) => p.remotePath === path);
  if (duplicate) return;
  const signed = await supabase.storage.from(damagePhotoBucket).createSignedUrl(path, 60 * 30);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error?.message || 'Could not load remote photo');
  }
  const response = await fetch(signed.data.signedUrl);
  if (!response.ok) {
    throw new Error('Could not download remote photo');
  }
  const blob = await response.blob();
  const fileExt = blob.type.includes('png') ? 'png' : 'jpg';
  const filename = `remote-${Date.now()}.${fileExt}`;
  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  capturedDamagePhotos.push({ id, file, url, remotePath: path });
  renderCapturedDamageThumbs();
}

function enqueuePendingRemoteDamagePhoto(parsed) {
  if (!parsed?.path) return;
  if (isRemoteDamagePathDismissed(parsed.path)) return;
  const exists = pendingRemoteDamagePhotos.some((item) => item.path === parsed.path);
  if (!exists) pendingRemoteDamagePhotos.push(parsed);
  updatePendingUploadsBadge();
}

async function flushPendingRemoteDamagePhotosForSelectedAsset() {
  purgeStalePendingRemoteDamagePhotos();
  if (!selectedAsset?.assetTag || !pendingRemoteDamagePhotos.length) return;
  const keep = [];
  for (const item of pendingRemoteDamagePhotos) {
    if (!item?.path) continue;
    const taggedForAsset = !item.assetTag || item.assetTag === selectedAsset.assetTag;
    if (!taggedForAsset) {
      keep.push(item);
      continue;
    }
    try {
      await addRemoteDamagePhotoToDrawer(item.path);
    } catch (err) {
      toast(err.message, true);
    }
  }
  pendingRemoteDamagePhotos = keep;
  updatePendingUploadsBadge();
}

async function subscribeRemoteScans(scanSessionId) {
  await stopRemoteSubscription();
  remoteChannel = supabase
    .channel(`remote-scan-search-${scanSessionId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'scan_events', filter: `scan_session_id=eq.${scanSessionId}` },
      (payload) => {
        const source = String(payload?.new?.source || '');
        if (source === 'remote_damage_photo') {
          const parsed = extractRemoteDamagePath(payload?.new);
          if (!parsed?.path) return;
          if (isRemoteDamagePathDismissed(parsed.path)) return;
          if (!damageDrawer?.classList.contains('open') || !selectedAsset?.assetId) {
            purgeStalePendingRemoteDamagePhotos();
            enqueuePendingRemoteDamagePhoto(parsed);
            toast('Remote photo received. Open Record Damage to attach it.');
            return;
          }
          if (parsed.assetTag && selectedAsset.assetTag && parsed.assetTag !== selectedAsset.assetTag) {
            toast(`Remote photo ignored: paired for ${parsed.assetTag}.`, true);
            return;
          }
          addRemoteDamagePhotoToDrawer(parsed.path)
            .then(() => toast('Remote damage photo added.'))
            .catch((err) => toast(err.message, true));
          return;
        }
        const barcode = payload?.new?.barcode;
        if (!barcode) return;
        searchInput.value = String(barcode);
        loadAssets().catch((err) => toast(err.message, true));
        toast(`Remote scan: ${barcode}`);
      }
    )
    .subscribe();
}

async function pullRemoteDamageEvents() {
  if (!remoteSessionId) return;
  const { data, error } = await supabase
    .from('scan_events')
    .select('id, barcode, source')
    .eq('scan_session_id', remoteSessionId)
    .eq('source', 'remote_damage_photo')
    .order('id', { ascending: false })
    .limit(30);
  if (error || !Array.isArray(data) || !data.length) return;
  data.slice().reverse().forEach((row) => {
    const eventId = Number(row.id);
    if (Number.isFinite(eventId) && seenRemoteDamageEventIds.has(eventId)) return;
    if (Number.isFinite(eventId)) {
      seenRemoteDamageEventIds.add(eventId);
      if (seenRemoteDamageEventIds.size > 200) {
        const values = Array.from(seenRemoteDamageEventIds).slice(-120);
        seenRemoteDamageEventIds.clear();
        values.forEach((v) => seenRemoteDamageEventIds.add(v));
      }
    }
    const parsed = extractRemoteDamagePath(row);
    if (!parsed?.path) return;
    if (isRemoteDamagePathDismissed(parsed.path)) return;
    if (!damageDrawer?.classList.contains('open') || !selectedAsset?.assetId) {
      purgeStalePendingRemoteDamagePhotos();
      enqueuePendingRemoteDamagePhoto(parsed);
      return;
    }
    if (parsed.assetTag && selectedAsset.assetTag && parsed.assetTag !== selectedAsset.assetTag) return;
    addRemoteDamagePhotoToDrawer(parsed.path).catch(() => {});
  });
}

function startRemoteDamageEventPoller() {
  if (remoteDamagePollTimer) window.clearInterval(remoteDamagePollTimer);
  remoteDamagePollTimer = window.setInterval(() => {
    pullRemoteDamageEvents().catch(() => {});
  }, 2200);
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
      remoteStatusFailureCount = 0;
      loadDismissedRemoteDamagePaths();
      pairStatus.textContent = 'Phone paired. Remote scanner active.';
      persistRemoteSession();
      setRemoteBadge('on', 'Remote Scanner: Connected');
      clearRemoteTimers();
      startRemoteExpiryTicker();
      startRemoteStatusMonitor();
      await subscribeRemoteScans(remoteSessionId);
      startRemoteDamageEventPoller();
      pullRemoteDamageEvents().catch(() => {});
      if (damageDrawer?.classList.contains('open') && selectedAsset?.assetTag) {
        queueRemoteDamageModeSync('damage', selectedAsset.assetTag);
      } else {
        queueRemoteDamageModeSync('scan', null);
      }
      setPairModalOpen(false);
      window.setTimeout(() => flashRemoteBadge(), 220);
    } catch {
      // keep polling
    }
  }, 1200);
}

async function generatePairingQr(force = false) {
  if (pairingGenerateInFlight && !force) return;
  if (force) {
    pairingGenerateInFlight = false;
  }
  pairingGenerateInFlight = true;
  if (pairRegenerateBtn) pairRegenerateBtn.disabled = true;
  try {
    setPairModalOpen(true);
    clearRemoteTimers();
    await ensureSessionFresh();
    pairStatus.textContent = 'Generating pairing QR...';
    pairMeta.textContent = '';
    remotePairingId = null;
    if (pairQrCanvas) {
      const ctx = pairQrCanvas.getContext('2d');
      ctx?.clearRect(0, 0, pairQrCanvas.width, pairQrCanvas.height);
    }
    const { data, error } = await supabase.functions.invoke('pairing-create', {
      body: { context: 'search', ttl_seconds: 45 }
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
    if (remoteScanBtn) {
      remoteScanBtn.classList.add('is-disconnecting');
      remoteScanBtn.disabled = true;
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
    await clearRemoteSessionLocal('Session ended.');
  } finally {
    if (remoteScanBtn) remoteScanBtn.disabled = false;
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
    remoteStatusFailureCount = 0;
    loadDismissedRemoteDamagePaths();
    pairStatus.textContent = 'Remote scanner active (global session).';
    setRemoteBadge('on', 'Remote Scanner: Connected');
    startRemoteExpiryTicker();
    startRemoteStatusMonitor();
    await subscribeRemoteScans(id);
    startRemoteDamageEventPoller();
    pullRemoteDamageEvents().catch(() => {});
    if (damageDrawer?.classList.contains('open') && selectedAsset?.assetTag) {
      queueRemoteDamageModeSync('damage', selectedAsset.assetTag);
    } else {
      queueRemoteDamageModeSync('scan', null);
    }
  } catch {
    clearPersistedRemoteSession();
    setRemoteBadge('off', 'Remote Scanner: Idle');
  }
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
  stopSessionKeepAlive = startSessionKeepAlive();

  scannerToggleBtn?.addEventListener('click', () => {
    toggleScanner().catch((err) => toast(err.message, true));
  });
  if (remoteScanBtn && !isDesktopMode()) {
    remoteScanBtn.hidden = true;
  }
  remoteScanBtn?.addEventListener('click', () => {
    if (remoteScanBtn.classList.contains('is-connected') || remoteSessionId) {
      endRemoteSession().catch((err) => toast(err.message, true));
      return;
    }
    setPairModalOpen(true);
    generatePairingQr(true).catch((err) => toast(err.message, true));
  });
  pairModalOverlay?.addEventListener('click', () => setPairModalOpen(false));
  pairModalCloseBtn?.addEventListener('click', () => setPairModalOpen(false));
  pairRegenerateBtn?.addEventListener('click', () => {
    generatePairingQr(true).catch((err) => toast(err.message, true));
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
  updatePendingUploadsBadge();
  if (pendingUploadsBadge) {
    pendingUploadsBadge.setAttribute('role', 'button');
    pendingUploadsBadge.setAttribute('tabindex', '0');
    pendingUploadsBadge.addEventListener('click', () => {
      jumpToPendingUploads().catch((err) => toast(err.message, true));
    });
    pendingUploadsBadge.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      jumpToPendingUploads().catch((err) => toast(err.message, true));
    });
  }
  clearFiltersBtn?.addEventListener('click', () => {
    stopScanner();
    searchInput.value = '';
    statusFilter.value = '';
    renderSearchPrompt();
  });
  drawerAssigneeSearch?.addEventListener('input', (event) => {
    selectedPerson = null;
    drawerAssigneeSelected.textContent = 'No assignee selected';
    window.clearTimeout(personSearchDebounce);
    personSearchDebounce = window.setTimeout(() => {
      searchPeople(event.target.value.trim()).catch((err) => toast(err.message, true));
    }, 180);
  });
  drawerSetAssigneeBtn?.addEventListener('click', () => {
    setAssigneeFromDrawer().catch((err) => toast(err.message, true));
  });
  drawerSaveNoteBtn?.addEventListener('click', () => {
    saveAssetNoteFromDrawer().catch((err) => toast(err.message, true));
  });
  drawerOpenDamageBtn?.addEventListener('click', () => {
    openDamageDrawerForSelectedAsset();
  });
  drawerReportDamageBtn?.addEventListener('click', () => {
    submitDamageFromDrawer().catch((err) => toast(err.message, true));
  });
  drawerDamageCameraToggleBtn?.addEventListener('click', () => {
    toggleDrawerDamageCamera().catch((err) => toast(err.message, true));
  });
  drawerDamageCameraCaptureBtn?.addEventListener('click', () => {
    captureDrawerDamagePhoto().catch((err) => toast(err.message, true));
  });
  drawerDamageUploadBtn?.addEventListener('click', () => drawerDamagePhotos?.click());
  damageDrawerCloseBtn?.addEventListener('click', () => setDamageDrawerOpen(false));
  damageDrawerCancelBtn?.addEventListener('click', () => setDamageDrawerOpen(false));
  drawerOverlay?.addEventListener('click', () => setDamageDrawerOpen(false));
  closeDrawerBtn?.addEventListener('click', () => setDamageDrawerOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setDamageDrawerOpen(false);
    }
  });
  drawerCreatePersonBtn?.addEventListener('click', () => {
    createPersonFromDrawer().catch((err) => toast(err.message, true));
  });
  window.addEventListener('asset-row-selected', (event) => {
    const detail = event.detail || {};
    saveDamageDraftForCurrentAsset();
    selectedAsset = {
      assetId: detail.assetId || '',
      assetTag: detail.assetTag || detail.serial || '',
      model: detail.model || '',
      status: detail.status || '',
      assignee: detail.assignedTo || '',
      notes: detail.notes || ''
    };
    selectedPerson = null;
    if (drawerAssigneeSearch) drawerAssigneeSearch.value = '';
    if (drawerAssigneeSelected) {
      drawerAssigneeSelected.textContent = detail.assignedTo
        ? `Current: ${detail.assignedTo}`
        : 'Current: Unassigned';
    }
    if (drawerAssigneeSuggestions) drawerAssigneeSuggestions.hidden = true;
    if (drawerCreatePersonBtn) drawerCreatePersonBtn.hidden = true;
    if (drawerNotes) {
      drawerNotes.textContent = detail.notes || '-';
    }
    const canWrite = Boolean(currentProfile && (currentProfile.role === 'admin' || currentProfile.role === 'tech'));
    if (drawerAssigneeEditor) {
      drawerAssigneeEditor.hidden = !canWrite;
    }
    if (drawerNoteEditor) {
      drawerNoteEditor.hidden = !canWrite;
    }
    if (drawerDamageEditor) {
      drawerDamageEditor.hidden = !canWrite;
    }
    if (drawerNoteInput) drawerNoteInput.value = '';
    restoreDamageDraftForAsset(selectedAsset.assetId);
    stopDrawerDamageCamera();
    setDamageDrawerOpen(false);
    if (damageDrawer?.classList.contains('open') && selectedAsset?.assetTag) {
      queueRemoteDamageModeSync('damage', selectedAsset.assetTag);
    }
  });
  bindSearch();
  restoreGlobalRemoteSession().catch((err) => toast(err.message, true));

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
      stopAutoRefresh();
      setDamageDrawerOpen(false);
      clearAllDamageDrafts();
      pendingRemoteDamagePhotos = [];
      updatePendingUploadsBadge();
      remoteSessionId = null;
      remoteSessionExpiresAt = null;
      dismissedRemoteDamagePaths.clear();
      clearRemoteTimers();
      clearPersistedRemoteSession();
      stopRemoteSubscription().catch(() => {});
      setRemoteBadge('off', 'Remote Scanner: Idle');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (!autoRefreshTimer) {
        startAutoRefresh();
      }
      if (remoteSessionId) {
        syncRemoteSessionState().catch(() => {});
      }
    }
  });

  syncScannerToggleButton();
  setDrawerCameraButtons();
  drawerDamageNotes?.addEventListener('input', () => {
    saveDamageDraftForCurrentAsset();
  });
  startPendingRemoteDamagePurgeTicker();
  startRemoteSessionWatchdog();
  window.addEventListener('beforeunload', stopScanner);
  window.addEventListener('beforeunload', () => {
    saveDamageDraftForCurrentAsset();
    stopDrawerDamageCamera();
    if (stopSessionKeepAlive) stopSessionKeepAlive();
    clearRemoteTimers();
    if (pendingRemotePurgeTimer) window.clearInterval(pendingRemotePurgeTimer);
    if (remoteSessionWatchdogTimer) window.clearInterval(remoteSessionWatchdogTimer);
    stopRemoteSubscription().catch(() => {});
  });
  window.addEventListener('beforeunload', stopAutoRefresh);
}

init().catch((err) => {
  toast(err.message, true);
});

function openDamageDrawerForSelectedAsset() {
  if (!selectedAsset?.assetId) {
    toast('Select an asset first.', true);
    return;
  }
  if (damageDrawerAssetMeta) {
    damageDrawerAssetMeta.textContent = `${selectedAsset.assetTag || '-'} - ${selectedAsset.model || ''}`.trim();
  }
  setDamageDrawerOpen(true);
  if (remoteSessionId && selectedAsset?.assetTag) {
    queueRemoteDamageModeSync('damage', selectedAsset.assetTag);
  }
  flushPendingRemoteDamagePhotosForSelectedAsset().catch((err) => toast(err.message, true));
}
