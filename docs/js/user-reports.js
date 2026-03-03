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
const reportForRow = qs('#userReportForRow');
const reportForText = qs('#userReportForText');
const assetsBody = qs('#userReportAssetsBody');
const damagesBody = qs('#userReportDamagesBody');
const exportPopoverRoot = qs('#userReportExportPopoverRoot');
const exportAsBtn = qs('#userReportExportAsBtn');
const exportPopoverMenu = qs('#userReportExportPopoverMenu');
const damagePhotoBucket = 'asset-damage-photos';

let selectedPerson = null;
let searchDebounce = null;
let stopConnectionBadgeMonitor = null;
let lastGenerated = false;
let generatedForName = '';
let currentAssetRows = [];
let currentDamageRows = [];
let currentDamagePhotoUrlMap = new Map();

function displayStatus(status) {
  const raw = String(status || '');
  return raw === 'checked_out' ? 'Assigned' : raw || '-';
}

function normalizeBuildingRoom(a) {
  return [a.building, a.room].filter(Boolean).join(' / ') || '-';
}

function formatDateOnly(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).format(date);
}

function fileSafeTs() {
  return new Date().toISOString().replace(/[:.]/g, '-');
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

function hideSuggestions() {
  if (!assigneeSuggestions) return;
  assigneeSuggestions.hidden = true;
  assigneeSuggestions.innerHTML = '';
}

function setRunState(hasRun) {
  if (resultsSection) resultsSection.hidden = !hasRun;
  if (reportForRow) reportForRow.hidden = !hasRun;
  if (resetBtn) resetBtn.hidden = !hasRun;
  if (exportPopoverRoot) exportPopoverRoot.hidden = !hasRun;
  if (!hasRun) closeExportPopover();
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
    assetsBody.innerHTML = '<tr><td colspan="6" class="dim">No assigned asset history for this assignee.</td></tr>';
    return;
  }
  assetsBody.innerHTML = rows.map((a) => {
    const current = Array.isArray(a.asset_current) ? a.asset_current[0] : a.asset_current;
    const serial = String(a.serial || a.asset_tag || '-').trim() || '-';
    const lookupTag = String(a.asset_tag || a.serial || '').trim();
    const assignee = current?.people?.display_name || '-';
    const currentAssigneeId = current?.assignee_person_id || current?.people?.id || null;
    const isCurrentForSelected = Boolean(
      selectedPerson?.id &&
      currentAssigneeId &&
      String(selectedPerson.id) === String(currentAssigneeId)
    );
    const serialCell = lookupTag
      ? `<a class="asset-jump-link mono" href="./index.html?tag=${encodeURIComponent(lookupTag)}" target="_blank" rel="noreferrer">${escapeHtml(serial)}</a>`
      : `<span class="mono">${escapeHtml(serial)}</span>`;
    return `
      <tr>
        <td>${serialCell}</td>
        <td>${escapeHtml(a.model || '-')}</td>
        <td>${escapeHtml(formatDateOnly(a.date_assigned))}</td>
        <td>${escapeHtml(displayStatus(a.status))}${isCurrentForSelected ? '<span class="user-report-current-badge">Current</span>' : ''}</td>
        <td>${escapeHtml(assignee)}</td>
        <td>${escapeHtml(normalizeBuildingRoom(a))}</td>
      </tr>
    `;
  }).join('');
}

function renderDamages(rows, photoUrlMap = new Map()) {
  if (!damagesBody) return;
  if (!rows.length) {
    damagesBody.innerHTML = '<tr><td colspan="5" class="dim">No damage history for this assignee.</td></tr>';
    return;
  }
  damagesBody.innerHTML = rows.map((row) => {
    const serial = String(row?.assets?.serial || row?.assets?.asset_tag || '-').trim() || '-';
    const lookupTag = String(row?.assets?.asset_tag || row?.assets?.serial || '').trim();
    const when = formatDateOnly(row?.created_at);
    const summary = String(row?.notes || row?.summary || '').trim() || '-';
    const reportedBy = String(row?.reported_by_name || '').trim() || '-';
    const photos = Array.isArray(row?.damage_photos) ? row.damage_photos : [];
    const photoThumbs = photos.map((photo, index) => {
      const path = String(photo?.storage_path || '').trim();
      const url = path ? photoUrlMap.get(path) : '';
      if (!url) return '';
      const label = `Open damage photo ${index + 1}`;
      return `<a class="user-report-photo-thumb" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" title="${escapeHtml(label)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}"></a>`;
    }).filter(Boolean).join('');
    const photosCell = photos.length
      ? `<div class="user-report-photo-cell"><span class="user-report-photo-count">${escapeHtml(String(photos.length))}</span>${photoThumbs ? `<div class="user-report-photo-grid">${photoThumbs}</div>` : ''}</div>`
      : '0';
    const serialCell = lookupTag
      ? `<a class="asset-jump-link mono" href="./index.html?tag=${encodeURIComponent(lookupTag)}" target="_blank" rel="noreferrer">${escapeHtml(serial)}</a>`
      : `<span class="mono">${escapeHtml(serial)}</span>`;
    return `
      <tr>
        <td>${serialCell}</td>
        <td>${escapeHtml(when)}</td>
        <td>${escapeHtml(summary)}</td>
        <td>${escapeHtml(reportedBy)}</td>
        <td>${photosCell}</td>
      </tr>
    `;
  }).join('');
}

async function buildDamagePhotoUrlMap(rows) {
  const paths = [...new Set(
    (rows || [])
      .flatMap((row) => Array.isArray(row?.damage_photos) ? row.damage_photos : [])
      .map((photo) => String(photo?.storage_path || '').trim())
      .filter(Boolean)
  )];
  if (!paths.length) return new Map();

  const { data, error } = await supabase.storage
    .from(damagePhotoBucket)
    .createSignedUrls(paths, 60 * 30);

  if (error) {
    toast(`Photo URL signing failed: ${error.message}`, true);
    return new Map();
  }

  const signedMap = new Map();
  (data || []).forEach((entry, index) => {
    if (entry?.signedUrl) {
      signedMap.set(paths[index], entry.signedUrl);
    }
  });
  return signedMap;
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

function getExportAssetRows() {
  return currentAssetRows.map((a) => {
    const current = Array.isArray(a.asset_current) ? a.asset_current[0] : a.asset_current;
    return {
      serial: String(a.serial || a.asset_tag || '').trim(),
      model: String(a.model || '').trim(),
      dateAssigned: formatDateOnly(a.date_assigned),
      status: displayStatus(a.status),
      assignee: String(current?.people?.display_name || '').trim(),
      buildingRoom: normalizeBuildingRoom(a)
    };
  });
}

function getExportDamageRows() {
  return currentDamageRows.map((row) => {
    const photos = Array.isArray(row?.damage_photos) ? row.damage_photos : [];
    const photoLinks = photos
      .map((photo) => currentDamagePhotoUrlMap.get(String(photo?.storage_path || '').trim()) || '')
      .filter(Boolean);
    return {
      serial: String(row?.assets?.serial || row?.assets?.asset_tag || '').trim(),
      date: formatDateOnly(row?.created_at),
      summary: String(row?.notes || row?.summary || '').trim(),
      reportedBy: String(row?.reported_by_name || '').trim(),
      photoCount: photos.length,
      photoLinks
    };
  });
}

function exportCsv() {
  const assetRows = getExportAssetRows();
  const damageRows = getExportDamageRows();
  const escapeCsv = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [
    '"Assignment history"',
    ['Serial', 'Model', 'Date Assigned', 'Status', 'Current Assignee', 'Building / Room'].map(escapeCsv).join(','),
    ...assetRows.map((r) => [r.serial, r.model, r.dateAssigned, r.status, r.assignee, r.buildingRoom].map(escapeCsv).join(',')),
    '',
    '"Damage report"',
    ['Serial', 'Date', 'Summary', 'Reported By', 'Photos'].map(escapeCsv).join(','),
    ...damageRows.map((r) => [r.serial, r.date, r.summary, r.reportedBy, r.photoCount].map(escapeCsv).join(','))
  ];
  downloadBlob(`user-report-${fileSafeTs()}.csv`, 'text/csv;charset=utf-8', lines.join('\n'));
}

function exportHtml() {
  const assetRows = getExportAssetRows();
  const damageRows = getExportDamageRows();
  const assigneeName = escapeHtml(generatedForName || 'Selected assignee');
  const assetTableRows = assetRows.map((r) => `
    <tr>
      <td>${escapeHtml(r.serial || '-')}</td>
      <td>${escapeHtml(r.model || '-')}</td>
      <td>${escapeHtml(r.dateAssigned || '-')}</td>
      <td>${escapeHtml(r.status || '-')}</td>
      <td>${escapeHtml(r.assignee || '-')}</td>
      <td>${escapeHtml(r.buildingRoom || '-')}</td>
    </tr>
  `).join('');
  const damageTableRows = damageRows.map((r) => {
    const thumbs = r.photoLinks.map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(url)}" alt="Damage photo ${index + 1}"></a>`).join('');
    return `
      <tr>
        <td>${escapeHtml(r.serial || '-')}</td>
        <td>${escapeHtml(r.date || '-')}</td>
        <td>${escapeHtml(r.summary || '-')}</td>
        <td>${escapeHtml(r.reportedBy || '-')}</td>
        <td>${escapeHtml(String(r.photoCount || 0))}${thumbs ? `<div class="thumbs">${thumbs}</div>` : ''}</td>
      </tr>
    `;
  }).join('');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>User Device History Report</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;}
h1,h2{margin:0 0 10px;}
p{color:#555;}
table{border-collapse:collapse;width:100%;margin-bottom:22px;}
th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:12px;vertical-align:top;}
th{background:#f3f3f3;}
.thumbs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.thumbs a{display:inline-flex;width:42px;height:42px;border:1px solid #ccc;overflow:hidden;border-radius:6px;}
.thumbs img{width:100%;height:100%;object-fit:cover;display:block;}
</style>
</head><body>
<h1>User Device History Report</h1>
<p>Assignee: ${assigneeName}</p>
<p>Generated ${new Date().toLocaleString()}</p>
<h2>Assignment history</h2>
<table><thead><tr><th>Serial</th><th>Model</th><th>Date Assigned</th><th>Status</th><th>Current Assignee</th><th>Building / Room</th></tr></thead><tbody>${assetTableRows || '<tr><td colspan="6">No rows</td></tr>'}</tbody></table>
<h2>Damage report</h2>
<table><thead><tr><th>Serial</th><th>Date</th><th>Summary</th><th>Reported By</th><th>Photos</th></tr></thead><tbody>${damageTableRows || '<tr><td colspan="5">No rows</td></tr>'}</tbody></table>
</body></html>`;
  downloadBlob(`user-report-${fileSafeTs()}.html`, 'text/html;charset=utf-8', html);
}

function exportPdf() {
  if (!window.jspdf?.jsPDF) {
    toast('PDF library not loaded.', true);
    return;
  }
  const assetRows = getExportAssetRows();
  const damageRows = getExportDamageRows();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text('User Device History Report', 14, 14);
  doc.setFontSize(10);
  doc.text(`Assignee: ${generatedForName || 'Selected assignee'}`, 14, 20);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 26);
  doc.autoTable({
    startY: 31,
    head: [['Serial', 'Model', 'Date Assigned', 'Status', 'Current Assignee', 'Building / Room']],
    body: assetRows.map((r) => [r.serial, r.model, r.dateAssigned, r.status, r.assignee, r.buildingRoom]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [34, 68, 120] }
  });
  const nextY = (doc.lastAutoTable?.finalY || 31) + 10;
  doc.autoTable({
    startY: nextY,
    head: [['Serial', 'Date', 'Summary', 'Reported By', 'Photos']],
    body: damageRows.map((r) => [r.serial, r.date, r.summary, r.reportedBy, String(r.photoCount || 0)]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [34, 68, 120] }
  });
  doc.save(`user-report-${fileSafeTs()}.pdf`);
}

function exportXlsx() {
  if (!window.XLSX) {
    toast('XLSX library not loaded.', true);
    return;
  }
  const assetRows = getExportAssetRows().map((r) => ({
    Serial: r.serial || '',
    Model: r.model || '',
    'Date Assigned': r.dateAssigned || '',
    Status: r.status || '',
    'Current Assignee': r.assignee || '',
    'Building / Room': r.buildingRoom || ''
  }));
  const damageRows = getExportDamageRows().map((r) => ({
    Serial: r.serial || '',
    Date: r.date || '',
    Summary: r.summary || '',
    'Reported By': r.reportedBy || '',
    Photos: r.photoCount || 0
  }));
  const wb = window.XLSX.utils.book_new();
  const wsAssets = window.XLSX.utils.json_to_sheet(assetRows);
  const wsDamage = window.XLSX.utils.json_to_sheet(damageRows);
  window.XLSX.utils.book_append_sheet(wb, wsAssets, 'Assignment History');
  window.XLSX.utils.book_append_sheet(wb, wsDamage, 'Damage Report');
  const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    `user-report-${fileSafeTs()}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    out
  );
}

function exportWith(fn) {
  try {
    if (!lastGenerated) {
      toast('Run a report first.', true);
      return;
    }
    fn();
  } catch (err) {
    toast(err.message || 'Export failed.', true);
  }
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
      runUserReport().catch((err) => toast(err.message || 'Failed to generate user report.', true));
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
      .select('asset_id, action, occurred_at')
      .eq('assignee_person_id', personId)
      .limit(10000);
    if (txErr) throw txErr;
    (txRows || []).forEach((r) => { if (r?.asset_id) assetIdSet.add(r.asset_id); });
    const assignedAtByAssetId = new Map();
    (txRows || []).forEach((row) => {
      if (!row?.asset_id || String(row?.action || '') !== 'out') return;
      const seen = assignedAtByAssetId.get(row.asset_id);
      const next = String(row.occurred_at || '').trim();
      if (!next) return;
      if (!seen || new Date(next).getTime() > new Date(seen).getTime()) {
        assignedAtByAssetId.set(row.asset_id, next);
      }
    });

    const assetIds = Array.from(assetIdSet);
    let assets = [];
    if (assetIds.length) {
      const { data: assetRows, error: assetErr } = await supabase
        .from('assets')
        .select('id, asset_tag, serial, model, status, building, room, asset_current(assignee_person_id, people(id, display_name))')
        .in('id', assetIds)
        .order('serial', { ascending: true })
        .limit(10000);
      if (assetErr) throw assetErr;
      assets = (assetRows || []).map((row) => ({
        ...row,
        date_assigned: assignedAtByAssetId.get(row.id) || null
      }));
    }

    const { data: damageRows, error: damageErr } = await supabase
      .from('damage_reports')
      .select('id, created_at, summary, notes, reported_by_name, assignee_person_id, damage_photos(storage_path), assets(serial, asset_tag)')
      .eq('assignee_person_id', personId)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (damageErr) throw damageErr;

    currentAssetRows = assets;
    currentDamageRows = damageRows || [];
    currentDamagePhotoUrlMap = await buildDamagePhotoUrlMap(currentDamageRows);
    generatedForName = String(person.display_name || '').trim() || 'Selected assignee';
    if (reportForText) reportForText.textContent = `User report for ${generatedForName}`;
    if (assigneeInput) assigneeInput.value = '';
    renderAssets(currentAssetRows);
    renderDamages(currentDamageRows, currentDamagePhotoUrlMap);
    lastGenerated = true;
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
  lastGenerated = false;
  generatedForName = '';
  currentAssetRows = [];
  currentDamageRows = [];
  currentDamagePhotoUrlMap = new Map();
  if (assigneeInput) assigneeInput.value = '';
  if (reportForText) reportForText.textContent = 'User report for -';
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
  qs('#userReportExportCsvBtn')?.addEventListener('click', () => exportWith(exportCsv));
  qs('#userReportExportXlsxBtn')?.addEventListener('click', () => exportWith(exportXlsx));
  qs('#userReportExportHtmlBtn')?.addEventListener('click', () => exportWith(exportHtml));
  qs('#userReportExportPdfBtn')?.addEventListener('click', () => exportWith(exportPdf));
  exportAsBtn?.addEventListener('click', () => toggleExportPopover());
  exportPopoverMenu?.addEventListener('click', () => closeExportPopover());
  document.addEventListener('click', (event) => {
    if (!exportPopoverRoot) return;
    if (!exportPopoverRoot.contains(event.target)) closeExportPopover();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeExportPopover();
  });

  window.addEventListener('beforeunload', () => {
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
  });

  resetUserReport();
}

init().catch((err) => toast(err.message, true));
