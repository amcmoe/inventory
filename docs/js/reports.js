import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav } from './ui.js';

const reportsTopbar = qs('#reportsTopbar');
const reportsNav = qs('#reportsNav');
const reportsLoadingPanel = qs('#reportsLoadingPanel');
const reportsMainSection = qs('#reportsMainSection');
const reportsBody = qs('#reportsBody');

const reportStatusFilter = qs('#reportStatusFilter');
const reportTypeFilter = qs('#reportTypeFilter');
const reportSearch = qs('#reportSearch');

let rowsCache = [];
let debounce = null;

function fileSafeTs() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeBuildingRoom(a) {
  return [a.building, a.room].filter(Boolean).join(' / ') || '-';
}

function rowToView(a) {
  const current = Array.isArray(a.asset_current) ? a.asset_current[0] : a.asset_current;
  return {
    serial: a.serial || a.asset_tag || '',
    type: a.equipment_type || '',
    model: a.model || '',
    assignee: current?.people?.display_name || '',
    status: a.status || '',
    buildingRoom: normalizeBuildingRoom(a)
  };
}

function renderRows(rows) {
  if (!rows.length) {
    reportsBody.innerHTML = '<tr><td colspan="6" class="dim">No assets match the current filters.</td></tr>';
    return;
  }
  reportsBody.innerHTML = rows.map((r) => `
    <tr>
      <td class="mono">${escapeHtml(r.serial)}</td>
      <td>${escapeHtml(r.type)}</td>
      <td>${escapeHtml(r.model)}</td>
      <td>${escapeHtml(r.assignee)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.buildingRoom)}</td>
    </tr>
  `).join('');
}

function applyClientFilters() {
  const q = reportSearch.value.trim().toLowerCase();
  const status = reportStatusFilter.value;
  const type = reportTypeFilter.value;

  const rows = rowsCache.filter((r) => {
    if (status && r.status !== status) return false;
    if (type && r.type !== type) return false;
    if (!q) return true;
    const hay = `${r.serial} ${r.type} ${r.model} ${r.assignee} ${r.status} ${r.buildingRoom}`.toLowerCase();
    return hay.includes(q);
  });
  renderRows(rows);
  return rows;
}

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(rows) {
  const headers = ['Serial', 'Type', 'Model', 'Assigned To', 'Status', 'Building / Room'];
  const escapeCsv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((r) => [r.serial, r.type, r.model, r.assignee, r.status, r.buildingRoom].map(escapeCsv).join(','))
  ];
  downloadBlob(`asset-report-${fileSafeTs()}.csv`, 'text/csv;charset=utf-8', lines.join('\n'));
}

function exportHtml(rows) {
  const tableRows = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.serial)}</td>
      <td>${escapeHtml(r.type)}</td>
      <td>${escapeHtml(r.model)}</td>
      <td>${escapeHtml(r.assignee)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.buildingRoom)}</td>
    </tr>
  `).join('');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Asset Report</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;}
h1{margin:0 0 10px;}
p{color:#555;}
table{border-collapse:collapse;width:100%;}
th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:12px;}
th{background:#f3f3f3;}
</style>
</head><body>
<h1>Asset Report</h1>
<p>Generated ${new Date().toLocaleString()}</p>
<table><thead><tr><th>Serial</th><th>Type</th><th>Model</th><th>Assigned To</th><th>Status</th><th>Building / Room</th></tr></thead>
<tbody>${tableRows}</tbody></table>
</body></html>`;

  downloadBlob(`asset-report-${fileSafeTs()}.html`, 'text/html;charset=utf-8', html);
}

function exportPdf(rows) {
  if (!window.jspdf?.jsPDF) {
    toast('PDF library not loaded.', true);
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('Asset Report', 14, 14);
  doc.setFontSize(10);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 20);
  doc.autoTable({
    startY: 25,
    head: [['Serial', 'Type', 'Model', 'Assigned To', 'Status', 'Building / Room']],
    body: rows.map((r) => [r.serial, r.type, r.model, r.assignee, r.status, r.buildingRoom]),
    styles: { fontSize: 8 }
  });
  doc.save(`asset-report-${fileSafeTs()}.pdf`);
}

async function loadRows() {
  const { data, error } = await supabase
    .from('assets')
    .select('asset_tag, serial, equipment_type, model, status, building, room, asset_current(assignee_person_id, people(display_name))')
    .order('serial', { ascending: true })
    .limit(2000);

  if (error) {
    toast(error.message, true);
    return;
  }

  rowsCache = (data || []).map(rowToView);
  const types = [...new Set(rowsCache.map((r) => r.type).filter(Boolean))].sort();
  reportTypeFilter.innerHTML = '<option value="">All types</option>' + types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  applyClientFilters();
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

  reportsLoadingPanel.hidden = true;
  reportsTopbar.hidden = false;
  reportsNav.hidden = false;
  reportsMainSection.hidden = false;

  qs('#refreshReportBtn').addEventListener('click', loadRows);
  reportStatusFilter.addEventListener('change', applyClientFilters);
  reportTypeFilter.addEventListener('change', applyClientFilters);
  reportSearch.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(applyClientFilters, 180);
  });

  qs('#exportCsvBtn').addEventListener('click', () => exportCsv(applyClientFilters()));
  qs('#exportHtmlBtn').addEventListener('click', () => exportHtml(applyClientFilters()));
  qs('#exportPdfBtn').addEventListener('click', () => exportPdf(applyClientFilters()));

  await loadRows();
}

init().catch((err) => toast(err.message, true));

