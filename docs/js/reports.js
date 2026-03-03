import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav, initConnectionBadgeMonitor } from './ui.js';

const reportsTopbar = qs('#reportsTopbar');
const reportsNav = qs('#reportsNav');
const reportsLoadingPanel = qs('#reportsLoadingPanel');
const reportsMainSection = qs('#reportsMainSection');
const reportsBody = qs('#reportsBody');

const reportStatusFilter = qs('#reportStatusFilter');
const reportTypeFilter = qs('#reportTypeFilter');
const reportManufacturerFilter = qs('#reportManufacturerFilter');
const reportModelFilter = qs('#reportModelFilter');
const reportBuildingFilter = qs('#reportBuildingFilter');
const reportRoomFilter = qs('#reportRoomFilter');
const reportOwnershipFilter = qs('#reportOwnershipFilter');
const reportObsoleteFilter = qs('#reportObsoleteFilter');
const reportPageSize = qs('#reportPageSize');
const generateReportBtn = qs('#generateReportBtn');
const resetReportBtn = qs('#resetReportBtn');
const reportPrevBtn = qs('#reportPrevBtn');
const reportNextBtn = qs('#reportNextBtn');
const reportPageInfo = qs('#reportPageInfo');
const reportCurrentPage = qs('#reportCurrentPage');
const reportResultInfo = qs('#reportResultInfo');
const reportPagerLeft = qs('#reportPagerLeft');
const reportPagerControls = qs('#reportPagerControls');
const reportResultsSection = qs('#reportResultsSection');
const exportPopoverRoot = qs('#exportPopoverRoot');
const exportAsBtn = qs('#exportAsBtn');
const exportPopoverMenu = qs('#exportPopoverMenu');

const kpiTotal = qs('#kpiTotal');
const kpiAssigned = qs('#kpiAssigned');
const kpiAvailable = qs('#kpiAvailable');
const kpiAttention = qs('#kpiAttention');

let stopConnectionBadgeMonitor = null;
let currentRows = [];
let currentPage = 1;
let totalPages = 1;
let totalCount = 0;
let lastGenerated = false;

function displayStatus(status) {
  const raw = String(status || '');
  return raw === 'checked_out' ? 'Assigned' : raw;
}

function fileSafeTs() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeBuildingRoom(a) {
  return [a.building, a.room].filter(Boolean).join(' / ') || '-';
}

function rowToView(a) {
  const current = Array.isArray(a.asset_current) ? a.asset_current[0] : a.asset_current;
  return {
    manufacturer: a.manufacturer || '',
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
    reportsBody.innerHTML = '<tr><td colspan="7" class="dim">No assets match the current report filters.</td></tr>';
    return;
  }
  reportsBody.innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.manufacturer || '-')}</td>
      <td class="mono">${escapeHtml(r.serial)}</td>
      <td>${escapeHtml(r.type)}</td>
      <td>${escapeHtml(r.model)}</td>
      <td>${escapeHtml(r.assignee)}</td>
      <td>${escapeHtml(displayStatus(r.status))}</td>
      <td>${escapeHtml(r.buildingRoom)}</td>
    </tr>
  `).join('');
}

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

function getFilters() {
  return {
    status: reportStatusFilter.value.trim(),
    type: reportTypeFilter.value.trim(),
    manufacturer: reportManufacturerFilter.value.trim(),
    model: reportModelFilter.value.trim(),
    building: reportBuildingFilter.value.trim(),
    room: reportRoomFilter.value.trim(),
    ownership: reportOwnershipFilter.value.trim(),
    obsolete: reportObsoleteFilter.value.trim()
  };
}

function applyFilters(query, filters, ignoreStatus = false) {
  let q = query;
  if (!ignoreStatus && filters.status) q = q.eq('status', filters.status);
  if (filters.type) q = q.eq('equipment_type', filters.type);
  if (filters.manufacturer) q = q.eq('manufacturer', filters.manufacturer);
  if (filters.model) q = q.eq('model', filters.model);
  if (filters.building) q = q.eq('building', filters.building);
  if (filters.room) q = q.eq('room', filters.room);
  if (filters.ownership) q = q.eq('ownership', filters.ownership);
  if (filters.obsolete) q = q.eq('obsolete', filters.obsolete === 'true');
  return q;
}

function setPagerState() {
  const page = Math.min(currentPage, totalPages || 1);
  const pageSize = Number(reportPageSize?.value || 20);
  const showPager = totalCount > pageSize;
  if (reportPagerLeft) reportPagerLeft.hidden = !showPager;
  if (reportPagerControls) reportPagerControls.hidden = !showPager;
  if (reportCurrentPage) reportCurrentPage.textContent = String(page);
  reportPageInfo.textContent = `of ${Math.max(totalPages, 1)} pages`;
  if (reportResultInfo) reportResultInfo.textContent = `Results: ${(totalCount || 0).toLocaleString()}`;
  reportPrevBtn.disabled = page <= 1;
  reportNextBtn.disabled = page >= totalPages;
}

function setReportRunState(hasRun) {
  if (reportResultsSection) reportResultsSection.hidden = !hasRun;
  if (exportPopoverRoot) exportPopoverRoot.hidden = !hasRun;
  if (resetReportBtn) resetReportBtn.hidden = !hasRun;
  if (!hasRun) closeExportPopover();
}

function resetReportBuilder() {
  reportStatusFilter.value = '';
  reportTypeFilter.value = '';
  reportManufacturerFilter.value = '';
  reportModelFilter.value = '';
  reportBuildingFilter.value = '';
  reportRoomFilter.value = '';
  reportOwnershipFilter.value = '';
  reportObsoleteFilter.value = '';
  reportPageSize.value = '20';

  currentRows = [];
  currentPage = 1;
  totalPages = 1;
  totalCount = 0;
  lastGenerated = false;
  if (reportsBody) reportsBody.innerHTML = '';
  if (reportResultInfo) reportResultInfo.textContent = 'Results: 0';
  if (reportCurrentPage) reportCurrentPage.textContent = '1';
  if (reportPageInfo) reportPageInfo.textContent = 'of 1 pages';
  setReportRunState(false);
}

function closeExportPopover() {
  if (!exportPopoverMenu || !exportAsBtn) return;
  exportPopoverMenu.hidden = true;
  exportAsBtn.setAttribute('aria-expanded', 'false');
}

function toggleExportPopover() {
  if (!exportPopoverMenu || !exportAsBtn) return;
  const next = exportPopoverMenu.hidden;
  exportPopoverMenu.hidden = !next;
  exportAsBtn.setAttribute('aria-expanded', next ? 'true' : 'false');
}

async function generateReport(resetPage = true) {
  await ensureSessionFresh();
  if (resetPage) currentPage = 1;
  const pageSize = Number(reportPageSize.value || 20);
  const from = (currentPage - 1) * pageSize;
  const to = from + pageSize - 1;
  const filters = getFilters();

  generateReportBtn.disabled = true;
  generateReportBtn.textContent = 'Generating...';

  try {
    let query = supabase
      .from('assets')
      .select('id, asset_tag, serial, manufacturer, equipment_type, model, status, building, room, ownership, obsolete, asset_current(assignee_person_id, people(display_name))', { count: 'exact' })
      .order('serial', { ascending: true })
      .range(from, to);
    query = applyFilters(query, filters);

    const { data, count, error } = await query;
    if (error) throw error;

    currentRows = (data || []).map(rowToView);
    totalCount = count || 0;
    totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
    renderRows(currentRows);
    setPagerState();
    lastGenerated = true;
    setReportRunState(true);
  } catch (err) {
    toast(err.message || 'Failed to generate report', true);
  } finally {
    generateReportBtn.disabled = false;
    generateReportBtn.textContent = 'Generate';
  }
}

async function loadSummaryAndFilters() {
  await ensureSessionFresh();
  const { data, error } = await supabase
    .from('assets')
    .select('id, status, equipment_type, manufacturer, model, building, room, ownership, obsolete')
    .order('serial', { ascending: true })
    .limit(5000);

  if (error) {
    toast(error.message, true);
    return;
  }

  const rows = (data || []).map((r) => ({
    status: r.status || '',
    type: r.equipment_type || '',
    manufacturer: r.manufacturer || '',
    model: r.model || '',
    building: r.building || '',
    room: r.room || '',
    ownership: r.ownership || '',
    obsolete: r.obsolete ? 'true' : 'false'
  }));

  updateSummaryKpis(rows);

  const types = [...new Set(rows.map((r) => r.type).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const makers = [...new Set(rows.map((r) => r.manufacturer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const models = [...new Set(rows.map((r) => r.model).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const buildings = [...new Set(rows.map((r) => r.building).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const rooms = [...new Set(rows.map((r) => r.room).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const ownerships = [...new Set(rows.map((r) => r.ownership).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  reportTypeFilter.innerHTML = '<option value="">All types</option>' + types.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  reportManufacturerFilter.innerHTML = '<option value="">All manufacturers</option>' + makers.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  reportModelFilter.innerHTML = '<option value="">All models</option>' + models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  reportBuildingFilter.innerHTML = '<option value="">All buildings</option>' + buildings.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  reportRoomFilter.innerHTML = '<option value="">All rooms</option>' + rooms.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  reportOwnershipFilter.innerHTML = '<option value="">Owned/leased</option>' + ownerships.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
}

async function fetchAllMatchingRows() {
  await ensureSessionFresh();
  const pageSize = 1000;
  const maxRows = 10000;
  const filters = getFilters();
  const results = [];
  let start = 0;

  while (start < maxRows) {
    let query = supabase
      .from('assets')
      .select('asset_tag, serial, manufacturer, equipment_type, model, status, building, room, ownership, obsolete, asset_current(assignee_person_id, people(display_name))')
      .order('serial', { ascending: true })
      .range(start, start + pageSize - 1);
    query = applyFilters(query, filters);
    const { data, error } = await query;
    if (error) throw error;
    const chunk = data || [];
    if (!chunk.length) break;
    results.push(...chunk.map(rowToView));
    if (chunk.length < pageSize) break;
    start += pageSize;
  }

  return results;
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
  const headers = ['Manufacturer', 'Serial', 'Type', 'Model', 'Assigned To', 'Status', 'Building / Room'];
  const escapeCsv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((r) => [r.manufacturer, r.serial, r.type, r.model, r.assignee, displayStatus(r.status), r.buildingRoom].map(escapeCsv).join(','))
  ];
  downloadBlob(`asset-report-${fileSafeTs()}.csv`, 'text/csv;charset=utf-8', lines.join('\n'));
}

function exportHtml(rows) {
  const tableRows = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.manufacturer)}</td>
      <td>${escapeHtml(r.serial)}</td>
      <td>${escapeHtml(r.type)}</td>
      <td>${escapeHtml(r.model)}</td>
      <td>${escapeHtml(r.assignee)}</td>
      <td>${escapeHtml(displayStatus(r.status))}</td>
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
<table><thead><tr><th>Manufacturer</th><th>Serial</th><th>Type</th><th>Model</th><th>Assigned To</th><th>Status</th><th>Building / Room</th></tr></thead>
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
    head: [['Manufacturer', 'Serial', 'Type', 'Model', 'Assigned To', 'Status', 'Building / Room']],
    body: rows.map((r) => [r.manufacturer, r.serial, r.type, r.model, r.assignee, displayStatus(r.status), r.buildingRoom]),
    styles: { fontSize: 8 }
  });
  doc.save(`asset-report-${fileSafeTs()}.pdf`);
}

function exportXlsx(rows) {
  if (!window.XLSX) {
    toast('XLSX library not loaded.', true);
    return;
  }
  const exportRows = rows.map((r) => ({
    Manufacturer: r.manufacturer || '',
    Serial: r.serial || '',
    Type: r.type || '',
    Model: r.model || '',
    'Assigned To': r.assignee || '',
    Status: displayStatus(r.status),
    'Building / Room': r.buildingRoom || ''
  }));
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.json_to_sheet(exportRows);
  window.XLSX.utils.book_append_sheet(wb, ws, 'Assets');
  const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    `asset-report-${fileSafeTs()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    out
  );
}

async function exportWith(fn) {
  try {
    if (!lastGenerated) {
      toast('Run a report first.', true);
      return;
    }
    const rows = await fetchAllMatchingRows();
    if (!rows.length) {
      toast('No rows to export for current report filters.', true);
      return;
    }
    fn(rows);
  } catch (err) {
    toast(err.message || 'Export failed', true);
  }
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

  reportsLoadingPanel.hidden = true;
  reportsTopbar.hidden = false;
  reportsNav.hidden = false;
  reportsMainSection.hidden = false;

  generateReportBtn.addEventListener('click', () => generateReport(true));
  reportPageSize.addEventListener('change', () => {
    if (lastGenerated) generateReport(true);
  });
  reportPrevBtn.addEventListener('click', () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    generateReport(false);
  });
  reportNextBtn.addEventListener('click', () => {
    if (currentPage >= totalPages) return;
    currentPage += 1;
    generateReport(false);
  });

  qs('#exportCsvBtn').addEventListener('click', () => exportWith(exportCsv));
  qs('#exportXlsxBtn').addEventListener('click', () => exportWith(exportXlsx));
  qs('#exportHtmlBtn').addEventListener('click', () => exportWith(exportHtml));
  qs('#exportPdfBtn').addEventListener('click', () => exportWith(exportPdf));
  resetReportBtn?.addEventListener('click', () => resetReportBuilder());
  exportAsBtn?.addEventListener('click', () => toggleExportPopover());
  exportPopoverMenu?.addEventListener('click', () => closeExportPopover());
  document.addEventListener('click', (event) => {
    if (!exportPopoverRoot) return;
    if (!exportPopoverRoot.contains(event.target)) closeExportPopover();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeExportPopover();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && lastGenerated) {
      generateReport(false).catch((err) => toast(err.message, true));
    }
  });

  window.addEventListener('beforeunload', () => {
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
  });

  await loadSummaryAndFilters();
  resetReportBuilder();
}

init().catch((err) => toast(err.message, true));
