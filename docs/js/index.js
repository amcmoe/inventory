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
const categoryFilter = qs('#categoryFilter');
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

    const card = document.createElement('article');
    card.className = 'asset-card';
    card.innerHTML = `
      <div class="asset-card-head">
        <div>
          <div class="asset-title">${escapeHtml(asset.device_name)}</div>
          <div class="asset-subtitle">${escapeHtml(asset.category || 'Uncategorized')}</div>
        </div>
        ${statusBadge(asset.status)}
      </div>
      <div class="meta">Serial: ${escapeHtml(asset.asset_tag)} | Equipment: ${escapeHtml(asset.equipment || '-')} | Manufacturer: ${escapeHtml(asset.manufacturer || '-')} | Model: ${escapeHtml(asset.model || '-')}</div>
      <div class="meta">Category: ${escapeHtml(asset.category || '-')} | Location: ${escapeHtml(asset.location || '-')} ${asset.building ? `| Building: ${escapeHtml(asset.building)}` : ''} ${asset.room ? `| Room: ${escapeHtml(asset.room)}` : ''}</div>
      <div class="meta">Condition: ${escapeHtml(asset.asset_condition || '-')} | Ownership: ${escapeHtml(asset.ownership || '-')}</div>
      <div class="meta">Current Assignee: ${escapeHtml(assignee)}</div>
      <div class="row asset-actions">
        <a class="btn" href="./asset.html?tag=${encodeURIComponent(asset.asset_tag)}">Open Asset</a>
      </div>
    `;
    assetList.appendChild(card);
  });
}

function fillFilterOptions(assets) {
  const categories = [...new Set(assets.map((a) => a.category).filter(Boolean))].sort();
  const locations = [...new Set(assets.map((a) => a.location).filter(Boolean))].sort();

  categoryFilter.innerHTML = '<option value="">All</option>' + categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  locationFilter.innerHTML = '<option value="">All</option>' + locations.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
}

async function loadAssets() {
  let query = supabase
    .from('assets')
    .select('id, asset_tag, serial, equipment, device_name, manufacturer, model, category, location, building, room, asset_condition, ownership, status, asset_current(assignee_person_id, checked_out_at, people(display_name))')
    .order('asset_tag', { ascending: true })
    .limit(200);

  const term = searchInput.value.trim();
  const status = statusFilter.value;
  const category = categoryFilter.value;
  const location = locationFilter.value;

  if (term) {
    query = query.or(`asset_tag.ilike.%${term}%,serial.ilike.%${term}%,equipment.ilike.%${term}%,device_name.ilike.%${term}%,manufacturer.ilike.%${term}%,model.ilike.%${term}%,location.ilike.%${term}%,building.ilike.%${term}%,room.ilike.%${term}%,asset_condition.ilike.%${term}%`);
  }
  if (status) {
    query = query.eq('status', status);
  }
  if (category) {
    query = query.eq('category', category);
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
  [searchInput, statusFilter, categoryFilter, locationFilter].forEach((el) => {
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
  searchPanel.style.display = '';
  resultsPanel.hidden = false;
  resultsPanel.style.display = '';
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
    .select('category, location')
    .order('category', { ascending: true })
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
      searchPanel.style.display = 'none';
      resultsPanel.hidden = true;
      resultsPanel.style.display = 'none';
      mainNav.hidden = true;
      mainNav.style.display = 'none';
      assetList.innerHTML = '';
    }
  });
}

init().catch((err) => {
  toast(err.message, true);
});
