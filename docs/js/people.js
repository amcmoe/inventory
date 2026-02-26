import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut } from './auth.js';
import { qs, toast, initTheme, bindThemeToggle, bindSignOut, initAdminNav } from './ui.js';

const peopleLoadingPanel = qs('#peopleLoadingPanel');
const peopleTopbar = qs('#peopleTopbar');
const peopleNav = qs('#peopleNav');
const peopleMainSection = qs('#peopleMainSection');

async function createPerson() {
  const payload = {
    p_display_name: qs('#personName').value.trim(),
    p_email: qs('#personEmail').value.trim() || null,
    p_employee_id: qs('#personEmployeeId').value.trim() || null,
    p_department: qs('#personDepartment').value.trim() || null
  };

  if (!payload.p_display_name) {
    toast('Display name is required.', true);
    return;
  }

  const { error } = await supabase.rpc('admin_create_person', payload);
  if (error) {
    toast(error.message, true);
    return;
  }

  qs('#personName').value = '';
  qs('#personEmail').value = '';
  qs('#personEmployeeId').value = '';
  qs('#personDepartment').value = '';
  toast('Person created.');
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

  qs('#savePersonBtn').addEventListener('click', createPerson);
}

init().catch((err) => toast(err.message, true));

