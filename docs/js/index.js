import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, sendMagicLink, signOut } from './auth.js';
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
const drawerAssigneeEditor = qs('#drawerAssigneeEditor');
const drawerAssigneeSearch = qs('#drawerAssigneeSearch');
const drawerAssigneeSuggestions = qs('#drawerAssigneeSuggestions');
const drawerAssigneeSelected = qs('#drawerAssigneeSelected');
const drawerSetAssigneeBtn = qs('#drawerSetAssigneeBtn');
const drawerCreatePersonBtn = qs('#drawerCreatePersonBtn');

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
let remotePairPollTimer = null;
let remoteExpireTimer = null;
let remoteChannel = null;

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
  assetTbody.innerHTML = '<tr><td colspan="5" class="dim">Type a serial or model to search for assets.</td></tr>';
  window.updateKpisFromTable?.();
}

function renderEmpty() {
  assetTbody.innerHTML = '<tr><td colspan="5" class="dim">No assets found for the current filters.</td></tr>';
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
    const locationLabel = asset.location || asset.building || '';
    return `
      <tr data-notes="${escapeHtml(asset.notes || '')}" data-asset-tag="${escapeHtml(lookupTag)}" data-serial="${escapeHtml(serial)}" data-model="${escapeHtml(asset.model || '')}" data-assignee="${escapeHtml(assignedTo || '')}" data-status="${escapeHtml(asset.status || '')}" data-location="${escapeHtml(locationLabel)}" data-room="${escapeHtml(asset.room || '')}">
        <td><a href="./asset.html?tag=${encodeURIComponent(lookupTag)}">${escapeHtml(serial)}</a></td>
        <td>${escapeHtml(asset.model || '')}</td>
        <td>${escapeHtml(assignedTo)}</td>
        <td>${escapeHtml(asset.status || '')}</td>
        <td>${escapeHtml(locationLabel)}</td>
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

  query = query.or(`asset_tag.ilike.%${term}%,serial.ilike.%${term}%,device_name.ilike.%${term}%,manufacturer.ilike.%${term}%,model.ilike.%${term}%,equipment_type.ilike.%${term}%,location.ilike.%${term}%,building.ilike.%${term}%,room.ilike.%${term}%,asset_condition.ilike.%${term}%`);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    toast(error.message, true);
    return;
  }
  renderAssets(data || []);
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
}

async function stopRemoteSubscription() {
  if (!remoteChannel) return;
  await supabase.removeChannel(remoteChannel);
  remoteChannel = null;
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
      pairEndSessionBtn.disabled = true;
      clearRemoteTimers();
      stopRemoteSubscription().catch(() => {});
    }
  }, 1000);
}

async function subscribeRemoteScans(scanSessionId) {
  await stopRemoteSubscription();
  remoteChannel = supabase
    .channel(`remote-scan-search-${scanSessionId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'scan_events', filter: `scan_session_id=eq.${scanSessionId}` },
      (payload) => {
        const barcode = payload?.new?.barcode;
        if (!barcode) return;
        searchInput.value = String(barcode);
        loadAssets().catch((err) => toast(err.message, true));
        toast(`Remote scan: ${barcode}`);
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
      pairEndSessionBtn.disabled = false;
      clearRemoteTimers();
      startRemoteExpiryTicker();
      await subscribeRemoteScans(remoteSessionId);
    } catch {
      // keep polling
    }
  }, 1200);
}

async function generatePairingQr() {
  pairStatus.textContent = 'Generating pairing QR...';
  pairMeta.textContent = '';
  pairEndSessionBtn.disabled = true;
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
  await window.QRCode.toCanvas(pairQrCanvas, payload, { width: 220, margin: 1 });
  pairStatus.textContent = 'Scan this QR with the shared phone.';
  pairMeta.textContent = `Pairing expires at ${new Date(data.expires_at).toLocaleTimeString()}`;
  await waitForPairedSession(remotePairingId);
}

async function endRemoteSession() {
  if (!remoteSessionId) return;
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
  pairEndSessionBtn.disabled = true;
  pairMeta.textContent = '';
  clearRemoteTimers();
  await stopRemoteSubscription();
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

  scannerToggleBtn?.addEventListener('click', () => {
    toggleScanner().catch((err) => toast(err.message, true));
  });
  if (remoteScanBtn && !isDesktopMode()) {
    remoteScanBtn.hidden = true;
  }
  remoteScanBtn?.addEventListener('click', () => {
    setPairModalOpen(true);
    generatePairingQr().catch((err) => toast(err.message, true));
  });
  pairModalOverlay?.addEventListener('click', () => setPairModalOpen(false));
  pairModalCloseBtn?.addEventListener('click', () => setPairModalOpen(false));
  pairRegenerateBtn?.addEventListener('click', () => {
    generatePairingQr().catch((err) => toast(err.message, true));
  });
  pairEndSessionBtn?.addEventListener('click', () => {
    endRemoteSession().catch((err) => toast(err.message, true));
  });
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
  drawerCreatePersonBtn?.addEventListener('click', () => {
    createPersonFromDrawer().catch((err) => toast(err.message, true));
  });
  window.addEventListener('asset-row-selected', (event) => {
    const detail = event.detail || {};
    selectedAsset = {
      assetTag: detail.assetTag || detail.serial || '',
      status: detail.status || '',
      assignee: detail.assignedTo || ''
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
    if (drawerAssigneeEditor) {
      drawerAssigneeEditor.hidden = !(currentProfile && (currentProfile.role === 'admin' || currentProfile.role === 'tech'));
    }
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
      stopAutoRefresh();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !autoRefreshTimer) {
      startAutoRefresh();
    }
  });

  syncScannerToggleButton();
  window.addEventListener('beforeunload', stopScanner);
  window.addEventListener('beforeunload', () => {
    clearRemoteTimers();
    stopRemoteSubscription().catch(() => {});
  });
  window.addEventListener('beforeunload', stopAutoRefresh);
}

init().catch((err) => {
  toast(err.message, true);
});

