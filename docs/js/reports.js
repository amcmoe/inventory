import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility, moduleCanView, applyModuleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav, initConnectionBadgeMonitor, loadSiteBrandingFromServer } from './ui.js';

const reportsTopbar = qs('#reportsTopbar');
const reportsNav = qs('#sidebarNav');
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
const reportHeadRow = qs('#reportHeadRow');
const reportCustomBanner = qs('#reportCustomBanner');
const exportPopoverRoot = qs('#exportPopoverRoot');
const exportAsBtn = qs('#exportAsBtn');
const exportPopoverMenu = qs('#exportPopoverMenu');

const reportBuilderBody = qs('#reportBuilderBody');
const reportBuilderToggle = qs('#reportBuilderToggle');
const reportPrebuiltCards = qs('#reportPrebuiltCards');
const reportFilterChips = qs('#reportFilterChips');
const reportSummaryBar = qs('#reportSummaryBar');
const reportColumnsToolbar = qs('#reportColumnsToolbar');
const reportColumnsBtn = qs('#reportColumnsBtn');
const reportColumnsDropdown = qs('#reportColumnsDropdown');

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
let activeCustomFilter = new URLSearchParams(window.location.search).get('kpi_custom') || '';
const defaultReportColumns = [
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'serial', label: 'Serial' },
  { key: 'type', label: 'Type' },
  { key: 'model', label: 'Model' },
  { key: 'assignee', label: 'Assigned To' },
  { key: 'status', label: 'Status' },
  { key: 'buildingRoom', label: 'Building / Room' }
];
let currentReportColumns = [...defaultReportColumns];

const customFilterLabels = {
  missing_serial_tag: 'Data Quality: Missing serial/tag',
  missing_model: 'Data Quality: Missing model',
  missing_building: 'Data Quality: Missing building',
  missing_service_date: 'Data Quality: Missing service date',
  missing_warranty_date: 'Data Quality: Missing warranty date',
  out_of_warranty: 'Warranty: Out of warranty',
  warranty_repair_out: 'Warranty: Devices out for warranty repair',
  top_device_damagers: 'Top 25 Device Damagers',
  top_damaged_devices: 'Top 25 Damaged Devices'
};

const prebuiltCustomQuerySections = [
  {
    title: 'Damage Insights',
    keys: ['top_device_damagers', 'top_damaged_devices']
  },
  {
    title: 'Warranty Insights',
    keys: ['warranty_repair_out', 'out_of_warranty']
  },
  {
    title: 'Data Quality Health',
    keys: [
      'missing_serial_tag',
      'missing_model',
      'missing_building',
      'missing_service_date',
      'missing_warranty_date'
    ]
  }
];

const filterDisplayConfig = {
  status: { label: 'Status', display: { checked_out: 'Assigned', available: 'Available', repair: 'Repair', retired: 'Retired' } },
  type: { label: 'Type' },
  manufacturer: { label: 'Manufacturer' },
  model: { label: 'Model' },
  building: { label: 'Building' },
  room: { label: 'Room' },
  ownership: { label: 'Ownership' },
  obsolete: { label: 'Lifecycle', display: { 'true': 'Obsolete', 'false': 'Active' } }
};

const filterSelectMap = {
  status: () => reportStatusFilter,
  type: () => reportTypeFilter,
  manufacturer: () => reportManufacturerFilter,
  model: () => reportModelFilter,
  building: () => reportBuildingFilter,
  room: () => reportRoomFilter,
  ownership: () => reportOwnershipFilter,
  obsolete: () => reportObsoleteFilter
};

function displayStatus(status) {
  const raw = String(status || '');
  if (raw === 'checked_out') return 'Assigned';
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

function isTop25CustomFilter(value = activeCustomFilter) {
  return value === 'top_device_damagers' || value === 'top_damaged_devices';
}

function renderReportHeaders(columns = defaultReportColumns) {
  if (!reportHeadRow) return;
  reportHeadRow.innerHTML = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
}

function formatReportCell(columnKey, value) {
  if (columnKey === 'status') return displayStatus(value);
  return value;
}

function updateCustomReportBanner() {
  if (!reportCustomBanner) return;
  const label = customFilterLabels[activeCustomFilter];
  if (!label) {
    reportCustomBanner.hidden = true;
    reportCustomBanner.textContent = '';
    return;
  }
  reportCustomBanner.hidden = false;
  reportCustomBanner.textContent = `Custom Report: ${label}`;
}

function syncCustomFilterUrl() {
  if (!window?.history?.replaceState) return;
  const params = new URLSearchParams(window.location.search);
  if (activeCustomFilter) params.set('kpi_custom', activeCustomFilter);
  else params.delete('kpi_custom');
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
  window.history.replaceState({}, document.title, next);
}

function renderPrebuiltStrip() {
  if (!reportPrebuiltCards) return;
  const cards = prebuiltCustomQuerySections.flatMap((section) =>
    section.keys.map((key) => {
      const label = customFilterLabels[key] || key;
      const isActive = activeCustomFilter === key ? ' is-active' : '';
      return `<button class="report-prebuilt-card${isActive}" type="button" data-kpi-custom="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
    })
  );
  reportPrebuiltCards.innerHTML = cards.join('');
}

async function selectPrebuiltCustomQuery(nextFilter = '') {
  activeCustomFilter = String(nextFilter || '').trim();
  syncCustomFilterUrl();
  resetReportBuilder(true);
  renderPrebuiltStrip();
  if (activeCustomFilter && customFilterLabels[activeCustomFilter]) {
    toast(`Loaded custom report: ${customFilterLabels[activeCustomFilter]}`);
    await generateReport(true);
    return;
  }
  toast('Custom query cleared.');
}

function renderFilterChips() {
  if (!reportFilterChips) return;
  const filters = getFilters();
  const chips = [];
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    const config = filterDisplayConfig[key];
    if (!config) continue;
    const displayValue = config.display?.[value] || value;
    chips.push(
      `<span class="report-filter-chip">` +
      `${escapeHtml(config.label)}: <strong>${escapeHtml(displayValue)}</strong>` +
      `<button type="button" aria-label="Remove ${escapeHtml(config.label)} filter" data-clear-filter="${escapeHtml(key)}">×</button>` +
      `</span>`
    );
  }
  if (!chips.length) {
    reportFilterChips.hidden = true;
    return;
  }
  reportFilterChips.hidden = false;
  reportFilterChips.innerHTML =
    `<span class="report-filter-chips-label">Filtered by</span>` +
    chips.join('') +
    `<button class="btn ghost report-clear-chips-btn" type="button" id="clearAllFiltersBtn">Clear all</button>`;
}

function updateSummaryBar() {
  if (!reportSummaryBar) return;
  const count = totalCount || 0;
  const noun = count === 1 ? 'asset' : 'assets';
  const customLabel = customFilterLabels[activeCustomFilter];
  let parts = [`<strong>${count.toLocaleString()}</strong> ${escapeHtml(noun)}`];
  if (customLabel) {
    parts.push(`Custom: ${escapeHtml(customLabel)}`);
  } else {
    const filters = getFilters();
    const activeLabels = Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => {
        const cfg = filterDisplayConfig[k];
        return escapeHtml(cfg?.display?.[v] || v);
      });
    if (activeLabels.length) parts.push(`Filtered by ${activeLabels.join(', ')}`);
  }
  reportSummaryBar.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  reportSummaryBar.hidden = false;
}

function renderColumnsDropdown() {
  if (!reportColumnsDropdown) return;
  reportColumnsDropdown.innerHTML = defaultReportColumns.map((col) => {
    const checked = currentReportColumns.some((c) => c.key === col.key);
    return (
      `<label class="report-columns-item">` +
      `<input type="checkbox" data-col="${escapeHtml(col.key)}"${checked ? ' checked' : ''}>` +
      `${escapeHtml(col.label)}` +
      `</label>`
    );
  }).join('');
}

function closeColumnsDropdown() {
  if (reportColumnsDropdown) reportColumnsDropdown.hidden = true;
}

function toggleColumnsDropdown() {
  if (!reportColumnsDropdown) return;
  reportColumnsDropdown.hidden = !reportColumnsDropdown.hidden;
}

function toggleColumn(key) {
  const col = defaultReportColumns.find((c) => c.key === key);
  if (!col) return;
  const idx = currentReportColumns.findIndex((c) => c.key === key);
  if (idx === -1) {
    const origIdx = defaultReportColumns.findIndex((c) => c.key === key);
    let insertAt = currentReportColumns.length;
    for (let i = 0; i < currentReportColumns.length; i++) {
      const currOrig = defaultReportColumns.findIndex((c) => c.key === currentReportColumns[i].key);
      if (currOrig > origIdx) { insertAt = i; break; }
    }
    currentReportColumns.splice(insertAt, 0, col);
  } else {
    if (currentReportColumns.length <= 1) return;
    currentReportColumns.splice(idx, 1);
  }
  renderReportHeaders(currentReportColumns);
  renderRows(currentRows);
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
    const emptyText = isTop25CustomFilter()
      ? 'No rows found for this custom Top 25 report.'
      : 'No assets match the current report filters.';
    reportsBody.innerHTML = `<tr><td colspan="${currentReportColumns.length}" class="dim">${escapeHtml(emptyText)}</td></tr>`;
    return;
  }
  reportsBody.innerHTML = rows.map((r) => `
    <tr>
      ${currentReportColumns.map((col) => {
        const raw = formatReportCell(col.key, r?.[col.key] ?? '');
        const isMono = col.key === 'serial';
        return `<td${isMono ? ' class="mono"' : ''}>${escapeHtml(String(raw || '-'))}</td>`;
      }).join('')}
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
    return s === 'repair' || s === 'retired';
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
  if (activeCustomFilter === 'missing_serial_tag') q = q.or('serial.is.null,serial.eq."",asset_tag.is.null,asset_tag.eq.""');
  if (activeCustomFilter === 'missing_model') q = q.or('model.is.null,model.eq.""');
  if (activeCustomFilter === 'missing_building') q = q.or('building.is.null,building.eq.""');
  if (activeCustomFilter === 'missing_service_date') q = q.is('service_start_date', null);
  if (activeCustomFilter === 'missing_warranty_date') q = q.is('warranty_expiration_date', null);
  if (activeCustomFilter === 'out_of_warranty') q = q.lt('warranty_expiration_date', new Date().toISOString().slice(0, 10));
  if (activeCustomFilter === 'warranty_repair_out') q = q.eq('status', 'repair').eq('out_for_warranty_repair', true);
  return q;
}

function setPagerState() {
  if (isTop25CustomFilter()) {
    if (reportPagerLeft) reportPagerLeft.hidden = false;
    if (reportPagerControls) reportPagerControls.hidden = true;
    if (reportCurrentPage) reportCurrentPage.textContent = '1';
    if (reportPageInfo) reportPageInfo.textContent = 'of 1 pages';
    if (reportResultInfo) {
      const label = customFilterLabels[activeCustomFilter] || 'Top 25';
      reportResultInfo.textContent = `Results: ${(totalCount || 0).toLocaleString()} (${label})`;
    }
    return;
  }

  const page = Math.min(currentPage, totalPages || 1);
  const pageSize = Number(reportPageSize?.value || 20);
  const showPager = totalCount > pageSize;
  if (reportPagerLeft) reportPagerLeft.hidden = !showPager;
  if (reportPagerControls) reportPagerControls.hidden = !showPager;
  if (reportCurrentPage) reportCurrentPage.textContent = String(page);
  reportPageInfo.textContent = `of ${Math.max(totalPages, 1)} pages`;
  if (reportResultInfo) {
    const label = customFilterLabels[activeCustomFilter];
    const base = `Results: ${(totalCount || 0).toLocaleString()}`;
    reportResultInfo.textContent = label ? `${base} (${label})` : base;
  }
  reportPrevBtn.disabled = page <= 1;
  reportNextBtn.disabled = page >= totalPages;
}

function setReportRunState(hasRun) {
  if (reportResultsSection) reportResultsSection.hidden = !hasRun;
  if (resetReportBtn) resetReportBtn.hidden = !hasRun;
  if (!hasRun) closeExportPopover();

  if (reportBuilderBody) reportBuilderBody.classList.toggle('is-collapsed', hasRun);
  if (reportBuilderToggle) {
    reportBuilderToggle.hidden = !hasRun;
    reportBuilderToggle.setAttribute('aria-expanded', hasRun ? 'false' : 'true');
    reportBuilderToggle.setAttribute('aria-label', hasRun ? 'Expand filters' : 'Collapse filters');
  }
}

function resetReportBuilder(keepCustomFilter = false) {
  reportStatusFilter.value = '';
  reportTypeFilter.value = '';
  reportManufacturerFilter.value = '';
  reportModelFilter.value = '';
  reportBuildingFilter.value = '';
  reportRoomFilter.value = '';
  reportOwnershipFilter.value = '';
  reportObsoleteFilter.value = '';
  reportPageSize.value = '20';
  if (!keepCustomFilter) {
    activeCustomFilter = '';
    syncCustomFilterUrl();
  }

  currentRows = [];
  currentReportColumns = [...defaultReportColumns];
  renderReportHeaders(currentReportColumns);
  currentPage = 1;
  totalPages = 1;
  totalCount = 0;
  lastGenerated = false;
  if (reportsBody) reportsBody.innerHTML = '';
  if (reportResultInfo) reportResultInfo.textContent = 'Results: 0';
  if (reportCurrentPage) reportCurrentPage.textContent = '1';
  if (reportPageInfo) reportPageInfo.textContent = 'of 1 pages';
  if (reportFilterChips) reportFilterChips.hidden = true;
  if (reportSummaryBar) reportSummaryBar.hidden = true;
  if (reportColumnsToolbar) reportColumnsToolbar.hidden = true;
  closeColumnsDropdown();
  setReportRunState(false);
  updateCustomReportBanner();
  renderPrebuiltStrip();
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

async function generateTop25CustomReport() {
  const topLimit = 25;

  if (activeCustomFilter === 'top_device_damagers') {
    const { data, error } = await supabase
      .from('damage_reports')
      .select('assignee_name, reported_by_name')
      .limit(50000);
    if (error) throw error;

    const counts = new Map();
    (data || []).forEach((row) => {
      const name = String(row?.assignee_name || row?.reported_by_name || '').trim() || 'Unassigned';
      counts.set(name, (counts.get(name) || 0) + 1);
    });

    currentReportColumns = [
      { key: 'rank', label: '#' },
      { key: 'user', label: 'User' },
      { key: 'damage_reports', label: 'Damage Reports' }
    ];
    renderReportHeaders(currentReportColumns);
    currentRows = [...counts.entries()]
      .map(([user, damage_reports]) => ({ user, damage_reports }))
      .sort((a, b) => b.damage_reports - a.damage_reports)
      .slice(0, topLimit)
      .map((row, idx) => ({ rank: idx + 1, ...row }));
  } else if (activeCustomFilter === 'top_damaged_devices') {
    const { data, error } = await supabase
      .from('damage_reports')
      .select('asset_id, assets(serial, asset_tag, model)')
      .limit(50000);
    if (error) throw error;

    const bySerial = new Map();
    (data || []).forEach((row) => {
      const asset = row?.assets || {};
      const serial = String(asset?.serial || asset?.asset_tag || '').trim() || 'Unknown';
      const model = String(asset?.model || '').trim() || '-';
      const key = `${serial}||${model}`;
      const existing = bySerial.get(key) || { serial, model, damage_reports: 0 };
      existing.damage_reports += 1;
      bySerial.set(key, existing);
    });

    currentReportColumns = [
      { key: 'rank', label: '#' },
      { key: 'serial', label: 'Serial' },
      { key: 'model', label: 'Model' },
      { key: 'damage_reports', label: 'Damage Reports' }
    ];
    renderReportHeaders(currentReportColumns);
    currentRows = [...bySerial.values()]
      .sort((a, b) => b.damage_reports - a.damage_reports)
      .slice(0, topLimit)
      .map((row, idx) => ({ rank: idx + 1, ...row }));
  } else {
    currentReportColumns = [...defaultReportColumns];
    renderReportHeaders(currentReportColumns);
    currentRows = [];
  }

  totalCount = currentRows.length;
  currentPage = 1;
  totalPages = 1;
  renderRows(currentRows);
  setPagerState();
  lastGenerated = true;
  setReportRunState(true);
  renderFilterChips();
  updateSummaryBar();
  if (reportColumnsToolbar) reportColumnsToolbar.hidden = true;
}

async function generateReport(resetPage = true) {
  await ensureSessionFresh();
  updateCustomReportBanner();
  if (isTop25CustomFilter()) {
    generateReportBtn.disabled = true;
    generateReportBtn.textContent = 'Generating...';
    try {
      await generateTop25CustomReport();
    } catch (err) {
      toast(err.message || 'Failed to generate report', true);
    } finally {
      generateReportBtn.disabled = false;
      generateReportBtn.textContent = 'Generate';
    }
    return;
  }

  if (resetPage) currentPage = 1;
  const pageSize = Number(reportPageSize.value || 20);
  const from = (currentPage - 1) * pageSize;
  const to = from + pageSize - 1;
  const filters = getFilters();

  generateReportBtn.disabled = true;
  generateReportBtn.textContent = 'Generating...';

  try {
    currentReportColumns = [...defaultReportColumns];
    renderReportHeaders(currentReportColumns);
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
    renderFilterChips();
    updateSummaryBar();
    if (reportColumnsToolbar) reportColumnsToolbar.hidden = false;
    renderColumnsDropdown();
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

function exportCellValue(row, key) {
  return formatReportCell(key, row?.[key] ?? '');
}

function exportCsv(rows) {
  const headers = currentReportColumns.map((c) => c.label);
  const escapeCsv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((r) => currentReportColumns.map((c) => exportCellValue(r, c.key)).map(escapeCsv).join(','))
  ];
  downloadBlob(`asset-report-${fileSafeTs()}.csv`, 'text/csv;charset=utf-8', lines.join('\n'));
}

function exportHtml(rows) {
  const th = currentReportColumns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const tableRows = rows.map((r) => `
    <tr>${currentReportColumns.map((c) => `<td>${escapeHtml(String(exportCellValue(r, c.key) ?? ''))}</td>`).join('')}</tr>
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
<table><thead><tr>${th}</tr></thead>
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
  const head = [currentReportColumns.map((c) => c.label)];
  const body = rows.map((r) => currentReportColumns.map((c) => String(exportCellValue(r, c.key) ?? '')));
  doc.autoTable({
    startY: 25,
    head,
    body,
    styles: { fontSize: 8 }
  });
  doc.save(`asset-report-${fileSafeTs()}.pdf`);
}

function exportXlsx(rows) {
  if (!window.XLSX) {
    toast('XLSX library not loaded.', true);
    return;
  }
  const exportRows = rows.map((r) => {
    const row = {};
    currentReportColumns.forEach((c) => {
      row[c.label] = exportCellValue(r, c.key);
    });
    return row;
  });
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
    const rows = isTop25CustomFilter() ? currentRows.slice() : await fetchAllMatchingRows();
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
  if (!moduleCanView(profile, 'inventory')) {
    window.location.href = './index.html';
    return;
  }
  setRoleVisibility(profile.role);
  applyModuleVisibility(profile);
  initAdminNav();
  await loadSiteBrandingFromServer({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh
  });
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

  reportPrebuiltCards?.addEventListener('click', (event) => {
    const target = event.target?.closest?.('[data-kpi-custom]');
    if (!target) return;
    const nextFilter = target.getAttribute('data-kpi-custom') || '';
    selectPrebuiltCustomQuery(nextFilter).catch((err) => toast(err.message || 'Failed to load custom report', true));
  });

  qs('#reportPrebuiltMobileToggle')?.addEventListener('click', () => {
    const strip = qs('#reportPrebuiltStrip');
    const isOpen = strip?.classList.toggle('is-open');
    qs('#reportPrebuiltMobileToggle')?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  });

  reportBuilderToggle?.addEventListener('click', () => {
    const isCollapsed = reportBuilderBody?.classList.contains('is-collapsed');
    reportBuilderBody?.classList.toggle('is-collapsed');
    reportBuilderToggle.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
    reportBuilderToggle.setAttribute('aria-label', isCollapsed ? 'Collapse filters' : 'Expand filters');
  });

  reportFilterChips?.addEventListener('click', (e) => {
    const clearBtn = e.target?.closest?.('[data-clear-filter]');
    if (clearBtn) {
      const key = clearBtn.getAttribute('data-clear-filter');
      const el = filterSelectMap[key]?.();
      if (el) {
        el.value = '';
        generateReport(true).catch((err) => toast(err.message || 'Failed', true));
      }
      return;
    }
    if (e.target?.id === 'clearAllFiltersBtn' || e.target?.closest?.('#clearAllFiltersBtn')) {
      resetReportBuilder();
    }
  });

  reportColumnsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColumnsDropdown();
  });

  reportColumnsDropdown?.addEventListener('change', (e) => {
    const cb = e.target?.closest?.('input[data-col]');
    if (!cb) return;
    toggleColumn(cb.getAttribute('data-col'));
  });

  exportAsBtn?.addEventListener('click', () => toggleExportPopover());
  exportPopoverMenu?.addEventListener('click', () => closeExportPopover());

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (exportPopoverRoot && !exportPopoverRoot.contains(target)) closeExportPopover();
    if (reportColumnsDropdown && !reportColumnsDropdown.hidden) {
      const wrap = qs('.report-columns-toggle-wrap');
      if (wrap && !wrap.contains(target)) closeColumnsDropdown();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeExportPopover();
      closeColumnsDropdown();
    }
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
  renderPrebuiltStrip();
  resetReportBuilder(true);
  if (activeCustomFilter && customFilterLabels[activeCustomFilter]) {
    toast(`Loaded custom report: ${customFilterLabels[activeCustomFilter]}`);
    await generateReport(true);
  }
}

init().catch((err) => toast(err.message, true));
