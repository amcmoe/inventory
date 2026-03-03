import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh } from './auth.js';
import { qs, toast, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav, initConnectionBadgeMonitor } from './ui.js';

const topbar = qs('#kpiReportsTopbar');
const nav = qs('#kpiReportsNav');
const loadingPanel = qs('#kpiReportsLoadingPanel');
const mainSection = qs('#kpiReportsMainSection');

const kpiTotal = qs('#kpiTotal');
const kpiAssigned = qs('#kpiAssigned');
const kpiAvailable = qs('#kpiAvailable');
const kpiAttention = qs('#kpiAttention');

let stopConnectionBadgeMonitor = null;

function updateSummaryKpis(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const assigned = list.filter((r) => String(r.status || '').toLowerCase() === 'checked_out').length;
  const available = list.filter((r) => String(r.status || '').toLowerCase() === 'available').length;
  const attention = list.filter((r) => {
    const s = String(r.status || '').toLowerCase();
    return s === 'repair' || s === 'retired' || s === 'maintenance';
  }).length;

  if (kpiTotal) kpiTotal.textContent = total.toLocaleString();
  if (kpiAssigned) kpiAssigned.textContent = assigned.toLocaleString();
  if (kpiAvailable) kpiAvailable.textContent = available.toLocaleString();
  if (kpiAttention) kpiAttention.textContent = attention.toLocaleString();
}

async function loadKpis() {
  await ensureSessionFresh();
  const { data, error } = await supabase
    .from('assets')
    .select('status')
    .limit(5000);

  if (error) {
    toast(error.message || 'Failed to load KPIs.', true);
    return;
  }
  updateSummaryKpis(data || []);
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

  loadingPanel.hidden = true;
  topbar.hidden = false;
  nav.hidden = false;
  mainSection.hidden = false;

  await loadKpis();

  window.addEventListener('beforeunload', () => {
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
  });
}

init().catch((err) => toast(err.message, true));

