import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, sendMagicLink, signOut } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility } from './ui.js';

const authPanel = qs('#authPanel');
const authShell = qs('#authShell');
const indexTopbar = qs('#indexTopbar');
const searchPanel = qs('#searchPanel');
const resultsPanel = qs('#resultsPanel');
const mainNav = qs('#mainNav');
const authMessage = qs('#authMessage');
const userMeta = qs('#userMeta');
const assetList = qs('#assetList');
const resultCount = qs('#resultCount');
const statTotal = qs('#statTotal');
const statAvailable = qs('#statAvailable');
const statCheckedOut = qs('#statCheckedOut');
const statRepairRetired = qs('#statRepairRetired');

const searchInput = qs('#searchInput');
const statusFilter = qs('#statusFilter');
const equipmentTypeFilter = qs('#equipmentTypeFilter');
const locationFilter = qs('#locationFilter');

let currentProfile = null;
let debounceTimer = null;

function statusBadge(status) {
  return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderStats(assets) {
  const available = assets.filter((a) => a.status === 'available').length;
  const checkedOut = assets.filter((a) => a.status === 'checked_out').length;
  const repairRetired = assets.filter((a) => a.status === 'repair' || a.status === 'retired').length;

  if (statTotal) statTotal.textContent = String(assets.length);
  if (statAvailable) statAvailable.textContent = String(available);
  if (statCheckedOut) statCheckedOut.textContent = String(checkedOut);
  if (statRepairRetired) statRepairRetired.textContent = String(repairRetired);
}

function renderAssets(assets) {
  assetList.innerHTML = '';
  resultCount.textContent = `${assets.length} asset(s)`;
  renderStats(assets);

  if (!assets.length) {
    assetList.innerHTML = '<div class="empty-state muted">No assets found for the current filters.</div>';
    return;
  }

  assets.forEach((asset) => {
    const current = Array.isArray(asset.asset_current) ? asset.asset_current[0] : asset.asset_current;
    const assignee = current?.people?.display_name || '-';
    const title = asset.model || asset.device_name || asset.asset_tag;
    const equipmentType = asset.equipment_type || 'Unspecified Type';
    const building = asset.building || '-';
    const room = asset.room || '-';
    const condition = asset.asset_condition || '-';
    const ownership = asset.ownership || '-';
    const statusClass = `status-${asset.status}`;

    const card = document.createElement('article');
    card.className = 'asset-card';
    card.innerHTML = `
      <div class="asset-hero">
        <div class="asset-avatar" aria-hidden="true">IT</div>
        <div class="asset-main">
          <div class="asset-title">${escapeHtml(title)}</div>
          <div class="asset-subtitle">${escapeHtml(equipmentType)}</div>
          <div class="asset-serial">Serial ${escapeHtml(asset.asset_tag)}</div>
        </div>
        <div class="asset-side">
          ${statusBadge(asset.status)}
          <a class="btn primary" href="./asset.html?tag=${encodeURIComponent(asset.asset_tag)}">Open Asset</a>
        </div>
      </div>
      <div class="asset-meta-grid ${escapeHtml(statusClass)}">
        <div class="meta-pill"><span class="meta-label">Manufacturer</span><span class="meta-value">${escapeHtml(asset.manufacturer || '-')}</span></div>
        <div class="meta-pill"><span class="meta-label">Model</span><span class="meta-value">${escapeHtml(asset.model || '-')}</span></div>
        <div class="meta-pill"><span class="meta-label">Building</span><span class="meta-value">${escapeHtml(building)}</span></div>
        <div class="meta-pill"><span class="meta-label">Room</span><span class="meta-value">${escapeHtml(room)}</span></div>
        <div class="meta-pill"><span class="meta-label">Condition</span><span class="meta-value">${escapeHtml(condition)}</span></div>
        <div class="meta-pill"><span class="meta-label">Ownership</span><span class="meta-value">${escapeHtml(ownership)}</span></div>
        <div class="meta-pill"><span class="meta-label">Assignee</span><span class="meta-value">${escapeHtml(assignee)}</span></div>
        <div class="meta-pill"><span class="meta-label">Location</span><span class="meta-value">${escapeHtml(asset.location || '-')}</span></div>
      </div>
    `;
    assetList.appendChild(card);
  });
}

function fillFilterOptions(assets) {
  const equipmentTypes = [...new Set(assets.map((a) => a.equipment_type).filter(Boolean))].sort();
  const locations = [...new Set(assets.map((a) => a.location).filter(Boolean))].sort();

  equipmentTypeFilter.innerHTML = '<option value="">All</option>' + equipmentTypes.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  locationFilter.innerHTML = '<option value="">All</option>' + locations.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
}

async function loadAssets() {
  let query = supabase
    .from('assets')
    .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, location, building, room, asset_condition, ownership, status, asset_current(assignee_person_id, checked_out_at, people(display_name))')
    .order('asset_tag', { ascending: true })
    .limit(200);

  const term = searchInput.value.trim();
  const status = statusFilter.value;
  const equipmentType = equipmentTypeFilter.value;
  const location = locationFilter.value;

  if (term) {
    query = query.or(`asset_tag.ilike.%${term}%,serial.ilike.%${term}%,device_name.ilike.%${term}%,manufacturer.ilike.%${term}%,model.ilike.%${term}%,equipment_type.ilike.%${term}%,location.ilike.%${term}%,building.ilike.%${term}%,room.ilike.%${term}%,asset_condition.ilike.%${term}%`);
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (equipmentType) {
    query = query.eq('equipment_type', equipmentType);
  }
  if (location) {
    query = query.eq('location', location);
  }

  const { data, error } = await query;
  if (error) {
    toast(error.message, true);
    return;
  }
  renderAssets(data || []);
}

function bindSearch() {
  [searchInput, statusFilter, equipmentTypeFilter, locationFilter].forEach((el) => {
    el.addEventListener('input', () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(loadAssets, 220);
    });
    el.addEventListener('change', loadAssets);
  });
}

async function initAuthedUI(session) {
  authPanel.hidden = true;
  if (authShell) authShell.hidden = true;
  if (indexTopbar) {
    indexTopbar.hidden = false;
    indexTopbar.style.display = '';
  }
  searchPanel.hidden = false;
  resultsPanel.hidden = false;
  mainNav.hidden = false;
  mainNav.style.display = '';

  try {
    currentProfile = await getCurrentProfile();
  } catch (err) {
    // Fallback so the page remains usable even if profile lookup fails.
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
    .select('equipment_type, location')
    .order('equipment_type', { ascending: true })
    .limit(500);

  if (!error && data) {
    fillFilterOptions(data);
  } else if (error) {
    toast(`Asset metadata load failed: ${error.message}`, true);
  }

  await loadAssets();
}

async function init() {
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

  qs('#signOutBtn').addEventListener('click', async () => {
    try {
      await signOut();
      window.location.reload();
    } catch (err) {
      toast(err.message, true);
    }
  });

  qs('#refreshBtn').addEventListener('click', loadAssets);
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
      if (authShell) authShell.hidden = false;
      if (indexTopbar) {
        indexTopbar.hidden = true;
        indexTopbar.style.display = 'none';
      }
      searchPanel.hidden = true;
      resultsPanel.hidden = true;
      mainNav.hidden = true;
      mainNav.style.display = 'none';
      assetList.innerHTML = '';
    }
  });
}

init().catch((err) => {
  toast(err.message, true);
});
