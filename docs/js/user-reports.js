import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav, initConnectionBadgeMonitor } from './ui.js';

const userReportsTopbar = qs('#userReportsTopbar');
const userReportsNav = qs('#userReportsNav');
const userReportsLoadingPanel = qs('#userReportsLoadingPanel');
const userReportsMainSection = qs('#userReportsMainSection');

const assigneeInput = qs('#userReportAssigneeFilter');
const assigneeSuggestions = qs('#userReportAssigneeSuggestions');
const generateBtn = qs('#generateUserReportBtn');
const resetBtn = qs('#resetUserReportBtn');
const resultsSection = qs('#userReportResultsSection');
const assetsBody = qs('#userReportAssetsBody');
const damagesBody = qs('#userReportDamagesBody');

let selectedPerson = null;
let searchDebounce = null;
let stopConnectionBadgeMonitor = null;

function displayStatus(status) {
  const raw = String(status || '');
  return raw === 'checked_out' ? 'Assigned' : raw || '-';
}

function normalizeBuildingRoom(a) {
  return [a.building, a.room].filter(Boolean).join(' / ') || '-';
}

function hideSuggestions() {
  if (!assigneeSuggestions) return;
  assigneeSuggestions.hidden = true;
  assigneeSuggestions.innerHTML = '';
}

function setRunState(hasRun) {
  if (resultsSection) resultsSection.hidden = !hasRun;
  if (resetBtn) resetBtn.hidden = !hasRun;
}

function sanitizeTerm(term) {
  return String(term || '')
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderAssets(rows) {
  if (!assetsBody) return;
  if (!rows.length) {
    assetsBody.innerHTML = '<tr><td colspan="5" class="dim">No assigned asset history for this assignee.</td></tr>';
    return;
  }
  assetsBody.innerHTML = rows.map((a) => {
    const current = Array.isArray(a.asset_current) ? a.asset_current[0] : a.asset_current;
    const serial = a.serial || a.asset_tag || '-';
    const assignee = current?.people?.display_name || '-';
    return `
      <tr>
        <td class="mono">${escapeHtml(serial)}</td>
        <td>${escapeHtml(a.model || '-')}</td>
        <td>${escapeHtml(displayStatus(a.status))}</td>
        <td>${escapeHtml(assignee)}</td>
        <td>${escapeHtml(normalizeBuildingRoom(a))}</td>
      </tr>
    `;
  }).join('');
}

function renderDamages(rows) {
  if (!damagesBody) return;
  if (!rows.length) {
    damagesBody.innerHTML = '<tr><td colspan="5" class="dim">No damage history for this assignee.</td></tr>';
    return;
  }
  damagesBody.innerHTML = rows.map((row) => {
    const serial = row?.assets?.serial || row?.assets?.asset_tag || '-';
    const when = row?.created_at ? new Date(row.created_at).toLocaleString() : '-';
    const summary = String(row?.notes || row?.summary || '').trim() || '-';
    const reportedBy = String(row?.reported_by_name || '').trim() || '-';
    const photos = Array.isArray(row?.damage_photos) ? row.damage_photos : [];
    return `
      <tr>
        <td>${escapeHtml(when)}</td>
        <td class="mono">${escapeHtml(serial)}</td>
        <td>${escapeHtml(summary)}</td>
        <td>${escapeHtml(reportedBy)}</td>
        <td>${escapeHtml(String(photos.length || 0))}</td>
      </tr>
    `;
  }).join('');
}

async function searchAssignees(term) {
  if (!assigneeSuggestions) return;
  const q = sanitizeTerm(term);
  if (!q || q.length < 2) {
    hideSuggestions();
    return;
  }

  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, email, employee_id')
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%,employee_id.ilike.%${q}%`)
    .order('display_name', { ascending: true })
    .limit(5);
  if (error) throw error;

  if (!Array.isArray(data) || !data.length) {
    assigneeSuggestions.innerHTML = '<div class="suggestion muted">No match found.</div>';
    assigneeSuggestions.hidden = false;
    return;
  }

  assigneeSuggestions.innerHTML = data.map((person) => {
    const name = escapeHtml(String(person.display_name || '').trim() || 'Unnamed');
    const sub = escapeHtml(String(person.email || person.employee_id || '').trim() || '-');
    return `
      <div class="suggestion" data-person-id="${escapeHtml(String(person.id || ''))}">
        <span>${name}</span><br>
        <span class="muted">${sub}</span>
      </div>
    `;
  }).join('');
  assigneeSuggestions.hidden = false;

  assigneeSuggestions.querySelectorAll('.suggestion[data-person-id]').forEach((node) => {
    node.addEventListener('click', () => {
      const person = data.find((p) => String(p.id) === String(node.getAttribute('data-person-id')));
      if (!person) return;
      selectedPerson = person;
      assigneeInput.value = String(person.display_name || '').trim();
      hideSuggestions();
    });
  });
}

async function resolvePersonFromInput() {
  if (selectedPerson?.id) return selectedPerson;
  const q = sanitizeTerm(assigneeInput?.value);
  if (!q) return null;
  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, email, employee_id')
    .or(`display_name.ilike.%${q}%,email.ilike.%${q}%,employee_id.ilike.%${q}%`)
    .order('display_name', { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

async function runUserReport() {
  await ensureSessionFresh();
  const person = await resolvePersonFromInput();
  if (!person?.id) {
    toast('Select an assignee first.', true);
    return;
  }
  selectedPerson = person;
  assigneeInput.value = String(person.display_name || '').trim();

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating...';
  try {
    const personId = person.id;
    const assetIdSet = new Set();

    const { data: currentRows, error: currentErr } = await supabase
      .from('asset_current')
      .select('asset_id')
      .eq('assignee_person_id', personId)
      .limit(5000);
    if (currentErr) throw currentErr;
    (currentRows || []).forEach((r) => { if (r?.asset_id) assetIdSet.add(r.asset_id); });

    const { data: txRows, error: txErr } = await supabase
      .from('transactions')
      .select('asset_id')
      .eq('assignee_person_id', personId)
      .limit(10000);
    if (txErr) throw txErr;
    (txRows || []).forEach((r) => { if (r?.asset_id) assetIdSet.add(r.asset_id); });

    const assetIds = Array.from(assetIdSet);
    let assets = [];
    if (assetIds.length) {
      const { data: assetRows, error: assetErr } = await supabase
        .from('assets')
        .select('id, asset_tag, serial, model, status, building, room, asset_current(assignee_person_id, people(display_name))')
        .in('id', assetIds)
        .order('serial', { ascending: true })
        .limit(10000);
      if (assetErr) throw assetErr;
      assets = assetRows || [];
    }

    const { data: damageRows, error: damageErr } = await supabase
      .from('damage_reports')
      .select('id, created_at, summary, notes, reported_by_name, assignee_person_id, damage_photos(storage_path), assets(serial, asset_tag)')
      .eq('assignee_person_id', personId)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (damageErr) throw damageErr;

    renderAssets(assets);
    renderDamages(damageRows || []);
    setRunState(true);
  } catch (err) {
    toast(err.message || 'Failed to generate user report.', true);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate';
  }
}

function resetUserReport() {
  selectedPerson = null;
  if (assigneeInput) assigneeInput.value = '';
  if (assetsBody) assetsBody.innerHTML = '';
  if (damagesBody) damagesBody.innerHTML = '';
  hideSuggestions();
  setRunState(false);
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
  if (!requireAuth(session)) return;

  const profile = await getCurrentProfile();
  setRoleVisibility(profile.role);
  initAdminNav();
  stopConnectionBadgeMonitor = initConnectionBadgeMonitor({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh,
    badgeSelector: '#connectionBadge'
  });

  userReportsLoadingPanel.hidden = true;
  userReportsTopbar.hidden = false;
  userReportsNav.hidden = false;
  userReportsMainSection.hidden = false;

  assigneeInput?.addEventListener('input', (event) => {
    selectedPerson = null;
    const value = String(event?.target?.value || '').trim();
    if (searchDebounce) window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => {
      searchAssignees(value).catch((err) => toast(err.message, true));
    }, 1000);
  });
  assigneeInput?.addEventListener('focus', (event) => {
    const value = String(event?.target?.value || '').trim();
    if (value.length >= 2) {
      searchAssignees(value).catch((err) => toast(err.message, true));
    }
  });
  assigneeInput?.addEventListener('blur', () => {
    window.setTimeout(() => hideSuggestions(), 150);
  });
  assigneeInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runUserReport().catch((err) => toast(err.message, true));
    }
  });

  generateBtn?.addEventListener('click', () => {
    runUserReport().catch((err) => toast(err.message, true));
  });
  resetBtn?.addEventListener('click', () => resetUserReport());

  window.addEventListener('beforeunload', () => {
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
  });

  resetUserReport();
}

init().catch((err) => toast(err.message, true));

