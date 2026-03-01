import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, sendMagicLink, signOut } from './auth.js';
import { qs, toast, escapeHtml, initTheme, bindThemeToggle, bindSignOut, initAdminNav } from './ui.js';

const peopleLoadingPanel = qs('#peopleLoadingPanel');
const peopleTopbar = qs('#peopleTopbar');
const peopleNav = qs('#peopleNav');
const peopleMainSection = qs('#peopleMainSection');
const assigneeSection = qs('#assigneeSection');
const assigneeHistorySection = qs('#assigneeHistorySection');
const assigneeHistoryMeta = qs('#assigneeHistoryMeta');
const assigneeHistoryTbody = qs('#assigneeHistoryTbody');
const assigneeDamageTbody = qs('#assigneeDamageTbody');

const appUsersTbody = qs('#appUsersTbody');
const assigneesTbody = qs('#assigneesTbody');
const refreshAppUsersBtn = qs('#refreshAppUsersBtn');
const appUserEmailInput = qs('#appUserEmail');
const inviteAppUserBtn = qs('#inviteAppUserBtn');

let assigneeDebounce = null;
let selectedAssigneeId = null;
let selectedAssigneeName = '';

function sanitizeFilterTerm(term) {
  return String(term || '')
    .replace(/[,%()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function setInviteVisibility(visible) {
  if (!inviteAppUserBtn) return;
  const hasEmail = Boolean(appUserEmailInput?.value.trim());
  inviteAppUserBtn.hidden = !(visible && hasEmail);
}

function renderAppUsers(rows) {
  if (!rows?.length) {
    appUsersTbody.innerHTML = '<tr><td colspan="4" class="muted">No app users found.</td></tr>';
    return;
  }
  appUsersTbody.innerHTML = rows.map((row) => `
    <tr data-user-id="${escapeHtml(row.user_id)}">
      <td>${escapeHtml(row.email || '')}</td>
      <td>${escapeHtml(row.display_name || '')}</td>
      <td>${escapeHtml(row.role || '')}</td>
      <td><button class="btn" type="button" data-load-user-id="${escapeHtml(row.user_id)}">Edit</button></td>
    </tr>
  `).join('');

  appUsersTbody.querySelectorAll('button[data-load-user-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-load-user-id');
      const row = rows.find((r) => r.user_id === id);
      if (!row) return;
      qs('#appUserEmail').value = row.email || '';
      qs('#appUserName').value = row.display_name || '';
      qs('#appUserRole').value = row.role || 'viewer';
      setInviteVisibility(true);
    });
  });
}

async function loadAppUsers() {
  if (refreshAppUsersBtn) {
    refreshAppUsersBtn.classList.add('is-spinning');
  }
  const { data, error } = await supabase.rpc('admin_list_app_users');
  if (refreshAppUsersBtn) {
    window.setTimeout(() => refreshAppUsersBtn.classList.remove('is-spinning'), 120);
  }
  if (error) {
    toast(error.message, true);
    return;
  }
  renderAppUsers(data || []);
}

async function saveAppUser() {
  const email = qs('#appUserEmail').value.trim().toLowerCase();
  const role = qs('#appUserRole').value;
  const displayName = qs('#appUserName').value.trim() || null;

  if (!email) {
    toast('User email is required.', true);
    return;
  }
  if (!['admin', 'tech', 'viewer'].includes(role)) {
    toast('Role is invalid.', true);
    return;
  }

  const { error } = await supabase.rpc('admin_upsert_profile_by_email', {
    p_email: email,
    p_role: role,
    p_display_name: displayName
  });
  if (error) {
    toast(error.message, true);
    return;
  }

  toast('App user saved.');
  setInviteVisibility(true);
  await loadAppUsers();
}

async function inviteAppUser() {
  const email = qs('#appUserEmail').value.trim().toLowerCase();
  if (!email) {
    toast('User email is required to send invite.', true);
    return;
  }
  await sendMagicLink(email);
  toast(`Magic link sent to ${email}.`);
}

function renderAssignees(rows) {
  if (!rows?.length) {
    assigneesTbody.innerHTML = '<tr><td colspan="5" class="muted">No assignees found.</td></tr>';
    return;
  }
  assigneesTbody.innerHTML = rows.map((row) => `
    <tr data-person-id="${escapeHtml(row.id)}">
      <td>${escapeHtml(row.display_name || '')}</td>
      <td>${escapeHtml(row.email || '')}</td>
      <td>${escapeHtml(row.employee_id || '')}</td>
      <td>${escapeHtml(row.department || '')}</td>
      <td><button class="btn" type="button" data-edit-person-id="${escapeHtml(row.id)}">Edit</button></td>
    </tr>
  `).join('');

  assigneesTbody.querySelectorAll('button[data-edit-person-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-person-id');
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      selectedAssigneeId = row.id;
      selectedAssigneeName = row.display_name || row.email || row.id;
      qs('#editAssigneeName').value = row.display_name || '';
      toast(`Selected assignee: ${row.display_name || row.email || row.id}`);
      loadAssigneeHistory(row.id, selectedAssigneeName).catch((err) => toast(err.message, true));
    });
  });
}

function renderAssigneeHistoryRows(rows) {
  if (!assigneeHistoryTbody) return;
  if (!rows.length) {
    assigneeHistoryTbody.innerHTML = '<tr><td colspan="6" class="muted">No assignment history for this assignee.</td></tr>';
    return;
  }
  assigneeHistoryTbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(new Date(row.occurred_at).toLocaleString())}</td>
      <td>${escapeHtml(String(row.action || '').toUpperCase())}</td>
      <td><a href="./asset.html?tag=${encodeURIComponent(row.asset_tag)}">${escapeHtml(row.asset_tag || '-')}</a></td>
      <td>${escapeHtml(row.model || '-')}</td>
      <td>${escapeHtml([row.building, row.room].filter(Boolean).join(' / ') || '-')}</td>
      <td>${escapeHtml(row.notes || '-')}</td>
    </tr>
  `).join('');
}

function renderAssigneeDamageRows(rows) {
  if (!assigneeDamageTbody) return;
  if (!rows.length) {
    assigneeDamageTbody.innerHTML = '<tr><td colspan="5" class="muted">No damage reports tied to this assignee.</td></tr>';
    return;
  }
  assigneeDamageTbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(new Date(row.created_at).toLocaleString())}</td>
      <td><a href="./asset.html?tag=${encodeURIComponent(row.asset_tag)}">${escapeHtml(row.asset_tag || '-')}</a></td>
      <td>${escapeHtml(row.summary || '-')}</td>
      <td>${escapeHtml(row.status || '-')}</td>
      <td>${escapeHtml(row.attribution || '-')}</td>
    </tr>
  `).join('');
}

async function loadAssigneeHistory(personId, personName = '') {
  if (!personId) return;
  if (assigneeHistorySection) assigneeHistorySection.hidden = false;
  if (assigneeHistoryMeta) assigneeHistoryMeta.textContent = `History for ${personName || 'selected assignee'}`;

  const { data: txData, error: txError } = await supabase
    .from('transactions')
    .select('id, asset_id, action, occurred_at, notes, assets(asset_tag, model, building, room)')
    .eq('assignee_person_id', personId)
    .order('occurred_at', { ascending: false })
    .limit(300);
  if (txError) {
    toast(txError.message, true);
    return;
  }
  const txRows = (txData || []).map((tx) => ({
    id: tx.id,
    asset_id: tx.asset_id,
    action: tx.action,
    occurred_at: tx.occurred_at,
    notes: tx.notes,
    asset_tag: tx.assets?.asset_tag || '',
    model: tx.assets?.model || '',
    building: tx.assets?.building || '',
    room: tx.assets?.room || ''
  }));
  renderAssigneeHistoryRows(txRows);

  const txIds = txRows.map((r) => r.id).filter(Boolean);
  const assetIds = [...new Set(txRows.map((r) => r.asset_id).filter(Boolean))];

  const exactDamageRows = [];
  if (txIds.length) {
    const { data: exactDamage, error: exactDamageError } = await supabase
      .from('damage_reports')
      .select('id, asset_id, created_at, summary, status, related_transaction_id, assets(asset_tag)')
      .in('related_transaction_id', txIds)
      .order('created_at', { ascending: false })
      .limit(300);
    if (exactDamageError) {
      toast(exactDamageError.message, true);
      return;
    }
    (exactDamage || []).forEach((row) => {
      exactDamageRows.push({
        id: row.id,
        asset_id: row.asset_id,
        asset_tag: row.assets?.asset_tag || '',
        created_at: row.created_at,
        summary: row.summary,
        status: row.status,
        attribution: 'Exact (linked transaction)'
      });
    });
  }

  const seenDamageIds = new Set(exactDamageRows.map((r) => r.id));
  const inferredDamageRows = [];
  if (assetIds.length) {
    const { data: allAssetTx, error: allAssetTxError } = await supabase
      .from('transactions')
      .select('id, asset_id, action, assignee_person_id, occurred_at')
      .in('asset_id', assetIds)
      .order('occurred_at', { ascending: true })
      .limit(1500);
    if (allAssetTxError) {
      toast(allAssetTxError.message, true);
      return;
    }

    const { data: assetDamage, error: assetDamageError } = await supabase
      .from('damage_reports')
      .select('id, asset_id, created_at, summary, status, related_transaction_id, assets(asset_tag)')
      .in('asset_id', assetIds)
      .order('created_at', { ascending: false })
      .limit(500);
    if (assetDamageError) {
      toast(assetDamageError.message, true);
      return;
    }

    const txByAsset = new Map();
    (allAssetTx || []).forEach((tx) => {
      const list = txByAsset.get(tx.asset_id) || [];
      list.push(tx);
      txByAsset.set(tx.asset_id, list);
    });

    (assetDamage || []).forEach((dr) => {
      if (seenDamageIds.has(dr.id)) return;
      const timeline = txByAsset.get(dr.asset_id) || [];
      const ts = new Date(dr.created_at).getTime();
      if (Number.isNaN(ts)) return;
      let lastOut = null;
      for (const tx of timeline) {
        const txTs = new Date(tx.occurred_at).getTime();
        if (Number.isNaN(txTs) || txTs > ts) break;
        if (tx.action === 'out') lastOut = tx;
      }
      if (lastOut?.assignee_person_id !== personId) return;
      inferredDamageRows.push({
        id: dr.id,
        asset_id: dr.asset_id,
        asset_tag: dr.assets?.asset_tag || '',
        created_at: dr.created_at,
        summary: dr.summary,
        status: dr.status,
        attribution: 'Inferred (legacy)'
      });
    });
  }

  const allDamage = [...exactDamageRows, ...inferredDamageRows]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  renderAssigneeDamageRows(allDamage);
}

async function loadAssignees() {
  const term = sanitizeFilterTerm(qs('#assigneeSearchInput').value);
  let query = supabase
    .from('people')
    .select('id, display_name, email, employee_id, department')
    .order('display_name', { ascending: true })
    .limit(100);
  if (term) {
    query = query.or(`display_name.ilike.%${term}%,email.ilike.%${term}%,employee_id.ilike.%${term}%,department.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) {
    toast(error.message, true);
    return;
  }
  renderAssignees(data || []);
}

async function saveAssigneeName() {
  const name = qs('#editAssigneeName').value.trim();
  if (!selectedAssigneeId) {
    toast('Select an assignee first.', true);
    return;
  }
  if (!name) {
    toast('Assignee name is required.', true);
    return;
  }
  const { error } = await supabase
    .from('people')
    .update({ display_name: name })
    .eq('id', selectedAssigneeId);
  if (error) {
    toast(error.message, true);
    return;
  }
  toast('Assignee name updated.');
  selectedAssigneeName = name;
  await loadAssignees();
  await loadAssigneeHistory(selectedAssigneeId, selectedAssigneeName);
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

  if (peopleLoadingPanel) peopleLoadingPanel.hidden = true;
  if (peopleTopbar) peopleTopbar.hidden = false;
  if (peopleNav) peopleNav.hidden = false;
  initAdminNav();
  if (peopleMainSection) peopleMainSection.hidden = false;
  if (assigneeSection) assigneeSection.hidden = false;
  if (assigneeHistorySection) assigneeHistorySection.hidden = true;

  qs('#saveAppUserBtn').addEventListener('click', () => {
    saveAppUser().catch((err) => toast(err.message, true));
  });
  inviteAppUserBtn?.addEventListener('click', () => {
    inviteAppUser().catch((err) => toast(err.message, true));
  });
  refreshAppUsersBtn?.addEventListener('click', () => {
    loadAppUsers().catch((err) => toast(err.message, true));
  });

  qs('#assigneeSearchInput').addEventListener('input', () => {
    window.clearTimeout(assigneeDebounce);
    assigneeDebounce = window.setTimeout(() => {
      loadAssignees().catch((err) => toast(err.message, true));
    }, 200);
  });
  qs('#saveAssigneeNameBtn').addEventListener('click', () => {
    saveAssigneeName().catch((err) => toast(err.message, true));
  });
  appUserEmailInput?.addEventListener('input', () => {
    setInviteVisibility(false);
  });
  setInviteVisibility(false);

  await loadAppUsers();
  await loadAssignees();

  const preselectPersonId = new URLSearchParams(window.location.search).get('person');
  if (preselectPersonId) {
    const { data: person, error: personError } = await supabase
      .from('people')
      .select('id, display_name, email')
      .eq('id', preselectPersonId)
      .maybeSingle();
    if (!personError && person) {
      selectedAssigneeId = person.id;
      selectedAssigneeName = person.display_name || person.email || person.id;
      qs('#editAssigneeName').value = person.display_name || '';
      if (assigneeHistorySection) assigneeHistorySection.hidden = false;
      await loadAssigneeHistory(person.id, selectedAssigneeName);
    }
  }
}

init().catch((err) => toast(err.message, true));
