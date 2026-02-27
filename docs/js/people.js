import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, sendMagicLink, signOut } from './auth.js';
import { qs, toast, escapeHtml, initTheme, bindThemeToggle, bindSignOut, initAdminNav } from './ui.js';

const peopleLoadingPanel = qs('#peopleLoadingPanel');
const peopleTopbar = qs('#peopleTopbar');
const peopleNav = qs('#peopleNav');
const peopleMainSection = qs('#peopleMainSection');
const assigneeSection = qs('#assigneeSection');

const appUsersTbody = qs('#appUsersTbody');
const assigneesTbody = qs('#assigneesTbody');
const refreshAppUsersBtn = qs('#refreshAppUsersBtn');
const appUserEmailInput = qs('#appUserEmail');
const inviteAppUserBtn = qs('#inviteAppUserBtn');

let assigneeDebounce = null;
let selectedAssigneeId = null;

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
      qs('#editAssigneeName').value = row.display_name || '';
      toast(`Selected assignee: ${row.display_name || row.email || row.id}`);
    });
  });
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
  await loadAssignees();
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
}

init().catch((err) => toast(err.message, true));
