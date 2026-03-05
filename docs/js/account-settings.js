import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh } from './auth.js';
import {
  qs,
  toast,
  setRoleVisibility,
  initTheme,
  bindThemeToggle,
  bindSignOut,
  initAdminNav,
  initConnectionBadgeMonitor,
  getSiteBranding,
  getSiteSettings,
  resetSiteBranding,
  saveSiteSettings,
  loadSiteBrandingFromServer,
  saveSiteBrandingToServer
} from './ui.js';

const topbar = qs('#accountSettingsTopbar');
const nav = qs('#sidebarNav');
const loadingPanel = qs('#accountSettingsLoadingPanel');
const mainSection = qs('#accountSettingsMainSection');

const saveBtn = qs('#saveBrandingBtn');
const resetBtn = qs('#resetBrandingBtn');

let stopConnectionBadgeMonitor = null;
const BRANDING_FIELD_DEFS = [
  { key: 'siteName', selector: '#settingsSiteName', defaultValue: 'IT Asset Management' },
  { key: 'companyName', selector: '#settingsCompanyName', defaultValue: 'SMSD Tech Team' }
];

function getBrandingInputs() {
  return BRANDING_FIELD_DEFS.map((def) => ({
    ...def,
    input: qs(def.selector)
  }));
}

function loadBrandingIntoForm() {
  const branding = getSiteBranding();
  getBrandingInputs().forEach(({ key, defaultValue, input }) => {
    if (!input) return;
    input.value = String(branding[key] || defaultValue);
  });
}

function saveBrandingFromForm() {
  const payload = {};
  getBrandingInputs().forEach(({ key, defaultValue, input }) => {
    payload[key] = String(input?.value || '').trim() || defaultValue;
  });
  const extraSettings = getSiteSettings();
  return saveSiteBrandingToServer({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh,
    siteName: payload.siteName,
    companyName: payload.companyName,
    settingsPatch: extraSettings
  }).then(() => {
    loadBrandingIntoForm();
    toast('Account settings saved.');
  });
}

function resetBrandingForm() {
  resetSiteBranding();
  saveSiteSettings({});
  loadBrandingIntoForm();
  saveSiteBrandingToServer({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh,
    siteName: 'IT Asset Management',
    companyName: 'SMSD Tech Team',
    settingsPatch: {}
  }).catch((err) => {
    toast(err.message || 'Failed to reset branding in database.', true);
  });
  toast('Branding reset to defaults.');
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
  if (profile.role !== 'admin') {
    toast('Admin role required.', true);
    window.location.href = './index.html';
    return;
  }

  initAdminNav();
  stopConnectionBadgeMonitor = initConnectionBadgeMonitor({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh,
    badgeSelector: '#connectionBadge'
  });

  loadingPanel.hidden = true;
  topbar.hidden = false;
  nav.hidden = false;
  mainSection.hidden = false;
  await loadSiteBrandingFromServer({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh
  });
  loadBrandingIntoForm();

  saveBtn?.addEventListener('click', () => {
    saveBrandingFromForm().catch((err) => {
      toast(err.message || 'Failed to save account settings.', true);
    });
  });
  resetBtn?.addEventListener('click', () => resetBrandingForm());
  getBrandingInputs().forEach(({ input }) => {
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveBrandingFromForm().catch((err) => {
        toast(err.message || 'Failed to save account settings.', true);
      });
    });
  });

  window.addEventListener('beforeunload', () => {
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
  });
}

init().catch((err) => toast(err.message, true));
