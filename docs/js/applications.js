import { supabase, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut, ensureSessionFresh } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility, moduleCanView, moduleCanEdit, applyModuleVisibility, initTheme, bindThemeToggle, bindSignOut, initAdminNav, initConnectionBadgeMonitor, loadSiteBrandingFromServer } from './ui.js';

const applicationsTopbar = qs('#applicationsTopbar');
const applicationsNav = qs('#sidebarNav');
const applicationsLoadingPanel = qs('#applicationsLoadingPanel');
const applicationsMainSection = qs('#applicationsMainSection');
const applicationsTbody = qs('#applicationsTbody');
const refreshApplicationsBtn = qs('#refreshApplicationsBtn');
const applicationsImportPopover = qs('#applicationsImportPopover');
const applicationsImportBtn = qs('#applicationsImportBtn');
const applicationsImportMenu = qs('#applicationsImportMenu');
const importApplicationsCsvBtn = qs('#importApplicationsCsvBtn');
const downloadApplicationsTemplateBtn = qs('#downloadApplicationsTemplateBtn');
const exportApplicationsCsvBtn = qs('#exportApplicationsCsvBtn');
const importApplicationsFile = qs('#importApplicationsFile');
const saveApplicationBtn = qs('#saveApplicationBtn');
const clearApplicationBtn = qs('#clearApplicationBtn');
const deleteApplicationBtn = qs('#deleteApplicationBtn');
const applicationsAccessHint = qs('#applicationsAccessHint');
const applicationSearchInput = qs('#applicationSearchInput');
const applicationStatusFilter = qs('#applicationStatusFilter');
const applicationAudienceFilter = qs('#applicationAudienceFilter');
const toggleApplicationFormBtn = qs('#toggleApplicationFormBtn');
const applicationsFormBlock = qs('#applicationsFormBlock');
const applicationPlatformChips = qs('#applicationPlatformChips');
const applicationPlatformFilterChips = qs('#applicationPlatformFilterChips');

const PLATFORM_OPTIONS = ['windows', 'macos', 'chromeos', 'ipados', 'web'];
const PLATFORM_LABELS = {
  all: 'All',
  windows: 'Windows',
  macos: 'macOS',
  chromeos: 'ChromeOS',
  ios: 'iOS',
  ipados: 'iPadOS',
  android: 'Android',
  web: 'Web',
  linux: 'Linux'
};
const PLATFORM_ICON_SVGS = {
  all: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg>',
  windows: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4.5l8-1.3v8.1H3zM12.5 3l8.5-1.5v9h-8.5zM3 11.8h8v8.2l-8-1.3zM12.5 11.8H21v9.1l-8.5-1.5z"/></svg>',
  macos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.8 6.1c.9-1.1 1.5-2.5 1.3-3.9-1.3.1-2.8.9-3.6 2-.7.9-1.4 2.3-1.2 3.6 1.4.1 2.7-.7 3.5-1.7z"/><path d="M18.9 17.2c-.5 1.1-.8 1.6-1.4 2.6-.8 1.3-1.9 2.9-3.2 2.9-1.2 0-1.5-.8-3.1-.8s-1.9.8-3.1.8c-1.3 0-2.3-1.4-3.1-2.7-2.2-3.4-2.4-7.4-1.1-9.5.9-1.5 2.3-2.4 3.7-2.4 1.5 0 2.4.8 3.6.8 1.2 0 1.9-.8 3.6-.8 1.2 0 2.5.7 3.4 1.9-3 1.8-2.6 6.1.7 7.2z"/></svg>',
  chromeos: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5h7.2M5.7 7.5l3.6 6.3M18.3 7.5l-3.8 6.5"/></svg>',
  ios: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.5 5h3"/><circle cx="12" cy="18.2" r="0.9"/></svg>',
  ipados: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2.2"/><circle cx="12" cy="18.2" r="0.9"/></svg>',
  android: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5h8c1.7 0 3 1.3 3 3v5.5h-2V12H7v6h-2v-5.5c0-1.7 1.3-3 3-3z"/><path d="M9 7l-1.4-2M15 7l1.4-2"/><circle cx="10" cy="9.2" r="0.6"/><circle cx="14" cy="9.2" r="0.6"/></svg>',
  web: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3c2.5 2.4 3.9 5.6 3.9 9s-1.4 6.6-3.9 9c-2.5-2.4-3.9-5.6-3.9-9S9.5 5.4 12 3z"/></svg>',
  linux: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.5c.8.8 1.9 1.3 3 1.3s2.2-.5 3-1.3"/><path d="M8.5 9.2c0-2 1.6-3.7 3.5-3.7s3.5 1.7 3.5 3.7v5.1c0 1.1-.9 2-2 2h-3c-1.1 0-2-.9-2-2z"/><circle cx="10.2" cy="10.1" r="0.55"/><circle cx="13.8" cy="10.1" r="0.55"/></svg>'
};
const AUDIENCE_OPTIONS = ['staff', 'students', 'both'];
const AUDIENCE_LABELS = {
  staff: 'Staff',
  students: 'Students',
  both: 'Both'
};

let currentProfile = null;
let stopConnectionBadgeMonitor = null;
let allApplications = [];
let allPeople = [];
let canEditApplications = false;
let isApplicationFormOpen = false;
let selectedApplicationPlatforms = new Set();
let selectedPlatformFilters = new Set();

function positionApplicationsImportMenu() {
  if (!applicationsImportBtn || !applicationsImportMenu) return;
  const btnRect = applicationsImportBtn.getBoundingClientRect();
  const menuRect = applicationsImportMenu.getBoundingClientRect();
  const gutter = 8;

  applicationsImportMenu.style.top = '';
  applicationsImportMenu.style.bottom = '';
  applicationsImportMenu.style.left = '';
  applicationsImportMenu.style.right = '';

  const spaceBelow = window.innerHeight - btnRect.bottom;
  const spaceAbove = btnRect.top;
  const openUp = spaceBelow < (menuRect.height + gutter) && spaceAbove > spaceBelow;
  if (openUp) {
    applicationsImportMenu.style.top = 'auto';
    applicationsImportMenu.style.bottom = `calc(100% + ${gutter}px)`;
  } else {
    applicationsImportMenu.style.top = `calc(100% + ${gutter}px)`;
    applicationsImportMenu.style.bottom = 'auto';
  }

  const rightAlignedLeft = btnRect.right - menuRect.width;
  const leftAlignedRight = btnRect.left + menuRect.width;
  if (rightAlignedLeft < gutter) {
    if (leftAlignedRight <= (window.innerWidth - gutter)) {
      applicationsImportMenu.style.left = '0';
      applicationsImportMenu.style.right = 'auto';
    } else {
      applicationsImportMenu.style.right = '0';
      applicationsImportMenu.style.left = 'auto';
    }
  } else {
    applicationsImportMenu.style.right = '0';
    applicationsImportMenu.style.left = 'auto';
  }
}

function setApplicationsImportMenuOpen(open) {
  if (applicationsImportMenu) applicationsImportMenu.hidden = !open;
  if (applicationsImportBtn) applicationsImportBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    positionApplicationsImportMenu();
  }
}

function setApplicationFormOpen(open, options = {}) {
  const shouldOpen = Boolean(open);
  isApplicationFormOpen = shouldOpen;
  if (applicationsFormBlock) applicationsFormBlock.hidden = !shouldOpen;
  if (toggleApplicationFormBtn) {
    toggleApplicationFormBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    toggleApplicationFormBtn.textContent = shouldOpen ? 'Hide Add / Edit' : 'Add / Edit Application';
  }
  if (shouldOpen && options.focusName) {
    qs('#applicationName')?.focus();
  }
}

function syncImportExportMenuActions() {
  const importCsvBtn = importApplicationsCsvBtn;
  const templateBtn = downloadApplicationsTemplateBtn;
  const importSectionLabels = Array.from(applicationsImportMenu?.querySelectorAll('.export-popover-section-label') || [])
    .filter((el) => String(el.textContent || '').trim().toLowerCase() === 'import');
  if (importCsvBtn) importCsvBtn.hidden = !canEditApplications;
  if (templateBtn) templateBtn.hidden = !canEditApplications;
  importSectionLabels.forEach((el) => { el.hidden = !canEditApplications; });
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadBlob(filename, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
    i += 1;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeImportHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const APPLICATION_IMPORT_HEADER_ALIASES = {
  name: 'name',
  applicationname: 'name',
  platform: 'platforms',
  platforms: 'platforms',
  ownercontact: 'owner_contact',
  owner: 'owner_contact',
  owneremail: 'owner_email',
  email: 'owner_email',
  referenceurl: 'reference_url',
  siteurl: 'reference_url',
  appstoreurl: 'app_store_url',
  status: 'status',
  audience: 'audience',
  notes: 'notes'
};

function normalizeImportStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'active';
  if (['active', 'inactive', 'deprecated'].includes(raw)) return raw;
  return '';
}

function toStatusLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'inactive') return 'Inactive';
  if (raw === 'deprecated') return 'Deprecated';
  return 'Active';
}

function normalizeAudience(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (AUDIENCE_OPTIONS.includes(raw)) return raw;
  return 'both';
}

function audienceLabel(value) {
  const normalized = normalizeAudience(value);
  if (normalized === 'both') return 'Staff & Students';
  return AUDIENCE_LABELS[normalized] || 'Staff & Students';
}

function normalizePlatformToken(token) {
  const raw = String(token || '').trim().toLowerCase();
  if (!raw) return '';
  const compact = raw.replace(/[^a-z0-9]+/g, '');
  if (['win', 'windows'].includes(compact)) return 'windows';
  if (['mac', 'macos', 'osx'].includes(compact)) return 'macos';
  if (['chromeos', 'chrome'].includes(compact)) return 'chromeos';
  if (['ios', 'iphone'].includes(compact)) return 'ios';
  if (['ipados', 'ipad'].includes(compact)) return 'ipados';
  if (['android'].includes(compact)) return 'android';
  if (['web', 'browser', 'saas'].includes(compact)) return 'web';
  if (['linux'].includes(compact)) return 'linux';
  return '';
}

function parsePlatformsInput(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const tokens = text.split(/[;,|/]+/g);
  const out = [];
  const seen = new Set();
  tokens.forEach((token) => {
    const normalized = normalizePlatformToken(token);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function normalizePlatformArray(value) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  const seen = new Set();
  list.forEach((token) => {
    const normalized = normalizePlatformToken(token);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

function platformsLabel(value) {
  const list = normalizePlatformArray(value);
  if (!list.length) return '-';
  return list.map((item) => PLATFORM_LABELS[item] || item).join(', ');
}

function syncChipButtons(chipContainer, selectedSet) {
  if (!chipContainer) return;
  chipContainer.querySelectorAll('.chip-toggle').forEach((btn) => {
    const value = String(btn.getAttribute('data-chip-value') || '').trim().toLowerCase();
    const active = value === 'all'
      ? PLATFORM_OPTIONS.every((platform) => selectedSet.has(platform))
      : selectedSet.has(value);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function bindChipPicker(chipContainer, selectedSet, onChange) {
  if (!chipContainer) return;
  chipContainer.querySelectorAll('.chip-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = String(btn.getAttribute('data-chip-value') || '').trim().toLowerCase();
      if (value === 'all') {
        const allSelected = PLATFORM_OPTIONS.every((platform) => selectedSet.has(platform));
        if (allSelected) selectedSet.clear();
        else PLATFORM_OPTIONS.forEach((platform) => selectedSet.add(platform));
        syncChipButtons(chipContainer, selectedSet);
        if (typeof onChange === 'function') onChange();
        return;
      }
      if (!PLATFORM_OPTIONS.includes(value)) return;
      if (selectedSet.has(value)) selectedSet.delete(value);
      else selectedSet.add(value);
      syncChipButtons(chipContainer, selectedSet);
      if (typeof onChange === 'function') onChange();
    });
  });
  syncChipButtons(chipContainer, selectedSet);
}

function decoratePlatformChipSet(chipContainer) {
  if (!chipContainer) return;
  chipContainer.querySelectorAll('.chip-toggle').forEach((btn) => {
    if (btn.querySelector('.chip-icon')) return;
    const value = String(btn.getAttribute('data-chip-value') || '').trim().toLowerCase();
    const label = PLATFORM_LABELS[value] || String(btn.textContent || '').trim();
    const icon = PLATFORM_ICON_SVGS[value] || '';
    btn.innerHTML = `<span class="chip-icon">${icon}</span><span class="chip-text">${escapeHtml(label)}</span>`;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  });
}

function resetForm() {
  qs('#applicationId').value = '';
  qs('#applicationName').value = '';
  selectedApplicationPlatforms.clear();
  syncChipButtons(applicationPlatformChips, selectedApplicationPlatforms);
  qs('#applicationOwnerContact').value = '';
  qs('#applicationReferenceUrl').value = '';
  qs('#applicationStoreUrl').value = '';
  qs('#applicationStatus').value = 'active';
  qs('#applicationAudience').value = 'both';
  qs('#applicationNotes').value = '';
  if (deleteApplicationBtn) deleteApplicationBtn.hidden = true;
}

function applyEditMode() {
  canEditApplications = moduleCanEdit(currentProfile, 'applications');
  const canEdit = canEditApplications;
  const inputs = [
    '#applicationName',
    '#applicationOwnerContact',
    '#applicationReferenceUrl',
    '#applicationStoreUrl',
    '#applicationStatus',
    '#applicationAudience',
    '#applicationNotes'
  ];
  inputs.forEach((selector) => {
    const el = qs(selector);
    if (!el) return;
    el.disabled = !canEdit;
  });
  if (saveApplicationBtn) saveApplicationBtn.hidden = !canEdit;
  if (clearApplicationBtn) clearApplicationBtn.hidden = !canEdit;
  if (deleteApplicationBtn) deleteApplicationBtn.hidden = true;
  if (toggleApplicationFormBtn) toggleApplicationFormBtn.hidden = !canEdit;
  if (!canEdit) setApplicationFormOpen(false);
  if (applicationPlatformChips) {
    applicationPlatformChips.querySelectorAll('.chip-toggle').forEach((btn) => { btn.disabled = !canEdit; });
  }
  if (applicationPlatformFilterChips) {
    applicationPlatformFilterChips.querySelectorAll('.chip-toggle').forEach((btn) => { btn.disabled = false; });
  }
  [applicationSearchInput, applicationStatusFilter, applicationAudienceFilter].forEach((el) => {
    if (el) el.disabled = false;
  });
  if (applicationsImportPopover) applicationsImportPopover.hidden = false;
  syncImportExportMenuActions();
  if (applicationsAccessHint) {
    applicationsAccessHint.textContent = canEdit
      ? 'Maintain software inventory and ownership references.'
      : 'Read-only access. Contact a Super User to request Applications edit access.';
  }
}

function renderApplications(rows) {
  if (!rows?.length) {
    applicationsTbody.innerHTML = '<tr><td colspan="7" class="muted">No applications found.</td></tr>';
    return;
  }
  const canEdit = moduleCanEdit(currentProfile, 'applications');
  applicationsTbody.innerHTML = rows.map((row) => {
    const ownerLabel = row.people?.display_name || row.owner_contact || '';
    const ref = String(row.reference_url || '').trim();
    const refHtml = ref
      ? `<a href="${escapeHtml(ref)}" target="_blank" rel="noopener noreferrer">Open</a>`
      : '-';
    return `
      <tr data-application-id="${escapeHtml(row.id)}">
        <td>${escapeHtml(row.name || '')}</td>
        <td>${escapeHtml(platformsLabel(row.platforms || []))}</td>
        <td>${escapeHtml(audienceLabel(row.audience))}</td>
        <td>${escapeHtml(ownerLabel)}</td>
        <td>${refHtml}</td>
        <td>${escapeHtml(toStatusLabel(row.status))}</td>
        <td>${canEdit ? `<button class="btn" type="button" data-edit-application-id="${escapeHtml(row.id)}">Edit</button>` : ''}</td>
      </tr>
    `;
  }).join('');

  if (!canEdit) return;
  applicationsTbody.querySelectorAll('button[data-edit-application-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-application-id');
      const row = rows.find((r) => String(r.id) === String(id));
      if (!row) return;
      qs('#applicationId').value = row.id || '';
      qs('#applicationName').value = row.name || '';
      selectedApplicationPlatforms.clear();
      normalizePlatformArray(row.platforms || []).forEach((platform) => selectedApplicationPlatforms.add(platform));
      syncChipButtons(applicationPlatformChips, selectedApplicationPlatforms);
      qs('#applicationOwnerContact').value = row.owner_contact || '';
      qs('#applicationReferenceUrl').value = row.reference_url || '';
      qs('#applicationStoreUrl').value = row.app_store_url || '';
      qs('#applicationStatus').value = row.status || 'active';
      qs('#applicationAudience').value = normalizeAudience(row.audience);
      qs('#applicationNotes').value = row.notes || '';
      if (deleteApplicationBtn) deleteApplicationBtn.hidden = false;
      setApplicationFormOpen(true);
      toast(`Editing ${row.name || 'application'}.`);
    });
  });
}

function applyTableFilters() {
  const filtered = getFilteredApplications();
  renderApplications(filtered);
}

function getFilteredApplications() {
  const searchTerm = String(applicationSearchInput?.value || '').trim().toLowerCase();
  const statusTerm = String(applicationStatusFilter?.value || '').trim().toLowerCase();
  const audienceTerm = String(applicationAudienceFilter?.value || '').trim().toLowerCase();
  return allApplications.filter((row) => {
    const ownerLabel = String(row.people?.display_name || row.owner_contact || '').toLowerCase();
    const rowPlatforms = normalizePlatformArray(row.platforms || []);
    const rowText = [
      row.name,
      platformsLabel(rowPlatforms),
      audienceLabel(row.audience),
      ownerLabel,
      row.reference_url,
      row.app_store_url,
      row.status,
      row.notes
    ].map((value) => String(value || '').toLowerCase()).join(' | ');
    const matchesSearch = !searchTerm || rowText.includes(searchTerm);
    const matchesStatus = !statusTerm || String(row.status || '').toLowerCase() === statusTerm;
    const normalizedAudience = normalizeAudience(row.audience);
    const matchesAudience = !audienceTerm
      || normalizedAudience === audienceTerm
      || (normalizedAudience === 'both' && (audienceTerm === 'staff' || audienceTerm === 'students'));
    const matchesPlatform = !selectedPlatformFilters.size
      || [...selectedPlatformFilters].some((platform) => rowPlatforms.includes(platform));
    return matchesSearch && matchesStatus && matchesAudience && matchesPlatform;
  });
}

function renderOwnerPeopleSelect() {
  // No owner dropdown in UI; people are still loaded for import owner_email mapping.
}

async function loadPeople() {
  await ensureSessionFresh();
  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, email')
    .order('display_name', { ascending: true })
    .limit(800);
  if (error) {
    toast(error.message || 'Failed to load people.', true);
    return;
  }
  allPeople = data || [];
  renderOwnerPeopleSelect();
}

async function loadApplications() {
  await ensureSessionFresh();
  if (refreshApplicationsBtn) refreshApplicationsBtn.classList.add('is-spinning');
  const { data, error } = await supabase
    .from('applications')
    .select('id, name, platforms, audience, owner_contact, owner_person_id, reference_url, app_store_url, status, notes, created_at, people(display_name)')
    .order('name', { ascending: true });
  if (refreshApplicationsBtn) {
    window.setTimeout(() => refreshApplicationsBtn.classList.remove('is-spinning'), 120);
  }
  if (error) {
    toast(error.message || 'Failed to load applications.', true);
    return;
  }
  allApplications = data || [];
  applyTableFilters();
}

async function deleteApplication(id) {
  await ensureSessionFresh();
  if (!moduleCanEdit(currentProfile, 'applications')) {
    toast('Applications edit access required.', true);
    return;
  }
  const { error } = await supabase
    .from('applications')
    .delete()
    .eq('id', id);
  if (error) {
    toast(error.message || 'Failed to delete application.', true);
    return;
  }
  if (String(qs('#applicationId').value || '') === String(id)) {
    resetForm();
  }
  toast('Application deleted.');
  await loadApplications();
}

function downloadApplicationsImportTemplate() {
  const headers = ['name', 'platforms', 'audience', 'owner_contact', 'owner_email', 'reference_url', 'app_store_url', 'status', 'notes'];
  const sampleRows = [
    ['Google Classroom', 'web', 'students', 'Curriculum Office', '', 'https://classroom.google.com', '', 'active', 'Primary LMS'],
    ['Zoom Workplace', 'web;windows;macos;ios;android', 'both', 'IT Help Desk', 'helpdesk@example.org', 'https://zoom.us', 'https://apps.apple.com/us/app/zoom-workplace/id546505307', 'active', 'District videoconferencing'],
    ['Legacy Inventory Tool', 'windows', 'staff', 'Tech Ops', '', '', '', 'deprecated', 'Reference only']
  ];
  const lines = [
    '# Notes: Required field -> name',
    '# Optional fields -> platforms, audience, owner_contact, owner_email, reference_url, app_store_url, notes',
    '# platforms accepts one or more values separated by ; , / or |',
    '# allowed platform values -> windows, macos, chromeos, ios, ipados, android, web, linux',
    '# audience must be one of: staff, students, both (default is both)',
    '# Free-text fields -> name, owner_contact, notes',
    '# status must be one of: active, inactive, deprecated',
    '# owner_email is optional; if it matches a person email, owner_person_id is auto-linked',
    headers.map(csvEscape).join(','),
    ...sampleRows.map((row) => row.map(csvEscape).join(','))
  ];
  downloadBlob('applications-import-template.csv', 'text/csv;charset=utf-8', `${lines.join('\n')}\n`);
}

function prepareApplicationImportRows(csvText) {
  const rows = parseCsvText(csvText).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
  if (!rows.length) {
    return { entries: [], errors: ['CSV is empty.'] };
  }
  const dataRows = rows.filter((row) => {
    const first = String(row[0] || '').trim();
    return !first.startsWith('#');
  });
  if (!dataRows.length) {
    return { entries: [], errors: ['CSV only contains notes/comments.'] };
  }

  const rawHeaders = dataRows[0];
  const mappedHeaders = rawHeaders.map((header) => APPLICATION_IMPORT_HEADER_ALIASES[normalizeImportHeader(header)] || '');
  const nameIndex = mappedHeaders.findIndex((h) => h === 'name');
  if (nameIndex < 0) {
    return { entries: [], errors: ['Missing required header: name'] };
  }

  const entries = [];
  const errors = [];
  dataRows.slice(1).forEach((row, idx) => {
    const rowNumber = idx + 2;
    const item = {};
    mappedHeaders.forEach((key, col) => {
      if (!key) return;
      item[key] = String(row[col] || '').trim();
    });
    const name = String(item.name || '').trim();
    if (!name) {
      errors.push(`Row ${rowNumber}: name is required.`);
      return;
    }
    const status = normalizeImportStatus(item.status);
    if (!status) {
      errors.push(`Row ${rowNumber}: status must be active, inactive, or deprecated.`);
      return;
    }
    const audience = normalizeAudience(item.audience || 'both');
    const platforms = parsePlatformsInput(item.platforms);
    entries.push({
      rowNumber,
      payload: {
        name,
        platforms,
        audience,
        owner_contact: item.owner_contact || null,
        owner_email: item.owner_email || null,
        reference_url: item.reference_url || null,
        app_store_url: item.app_store_url || null,
        status,
        notes: item.notes || null
      }
    });
  });
  return { entries, errors };
}

async function applyApplicationsImport(entries) {
  await ensureSessionFresh();
  if (!moduleCanEdit(currentProfile, 'applications')) {
    toast('Applications edit access required.', true);
    return;
  }
  const session = await getSession();
  const userId = session?.user?.id || null;
  const peopleByEmail = new Map(
    allPeople
      .filter((p) => String(p.email || '').trim())
      .map((p) => [String(p.email || '').trim().toLowerCase(), p.id])
  );

  let okCount = 0;
  let errorCount = 0;
  const rowErrors = [];
  for (const entry of entries) {
    const payload = { ...entry.payload };
    const ownerEmail = String(payload.owner_email || '').trim().toLowerCase();
    if (ownerEmail) {
      payload.owner_person_id = peopleByEmail.get(ownerEmail) || null;
    }
    delete payload.owner_email;
    payload.updated_by_user_id = userId;

    try {
      const { data: existing, error: findError } = await supabase
        .from('applications')
        .select('id')
        .eq('name', payload.name)
        .limit(1);
      if (findError) throw findError;
      if (existing?.length) {
        const { error: updateError } = await supabase
          .from('applications')
          .update(payload)
          .eq('id', existing[0].id);
        if (updateError) throw updateError;
      } else {
        payload.created_by_user_id = userId;
        const { error: insertError } = await supabase
          .from('applications')
          .insert(payload);
        if (insertError) throw insertError;
      }
      okCount += 1;
    } catch (err) {
      errorCount += 1;
      rowErrors.push(`Row ${entry.rowNumber}: ${err.message || 'Unknown error'}`);
    }
  }

  await loadApplications();
  toast(`Import complete. Success: ${okCount}, Failed: ${errorCount}.`, errorCount > 0);
  if (rowErrors.length) {
    const preview = rowErrors.slice(0, 5).join(' | ');
    toast(preview, true);
  }
}

function exportApplicationsCsv() {
  const rows = getFilteredApplications();
  if (!rows.length) {
    toast('No applications to export for current filters.', true);
    return;
  }
  const headers = [
    'name',
    'platforms',
    'audience',
    'owner_contact',
    'owner_person_name',
    'reference_url',
    'app_store_url',
    'status',
    'notes'
  ];
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach((row) => {
    lines.push([
      row.name || '',
      normalizePlatformArray(row.platforms || []).join(';'),
      normalizeAudience(row.audience),
      row.owner_contact || '',
      row.people?.display_name || '',
      row.reference_url || '',
      row.app_store_url || '',
      row.status || '',
      row.notes || ''
    ].map(csvEscape).join(','));
  });
  downloadBlob(`applications-export-${Date.now()}.csv`, 'text/csv;charset=utf-8', `${lines.join('\n')}\n`);
  toast(`Exported ${rows.length} applications.`);
}

async function handleApplicationsImportFileSelection(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    toast('Please choose a CSV file.', true);
    event.target.value = '';
    return;
  }
  const text = await file.text();
  const { entries, errors } = prepareApplicationImportRows(text);
  if (errors.length) {
    toast(errors[0], true);
    event.target.value = '';
    return;
  }
  if (!entries.length) {
    toast('No valid rows found in CSV.', true);
    event.target.value = '';
    return;
  }
  const proceed = window.confirm(`Import ${entries.length} application rows? Existing records with the same name will be updated.`);
  if (!proceed) {
    event.target.value = '';
    return;
  }
  await applyApplicationsImport(entries);
  event.target.value = '';
}

async function saveApplication() {
  await ensureSessionFresh();
  if (!moduleCanEdit(currentProfile, 'applications')) {
    toast('Applications edit access required.', true);
    return;
  }
  const id = qs('#applicationId').value.trim();
  const name = qs('#applicationName').value.trim();
  const platforms = [...selectedApplicationPlatforms];
  const ownerContact = qs('#applicationOwnerContact').value.trim() || null;
  const referenceUrl = qs('#applicationReferenceUrl').value.trim() || null;
  const appStoreUrl = qs('#applicationStoreUrl').value.trim() || null;
  const status = qs('#applicationStatus').value;
  const audience = normalizeAudience(qs('#applicationAudience').value);
  const notes = qs('#applicationNotes').value.trim() || null;

  if (!name) {
    toast('Application name is required.', true);
    return;
  }
  if (!['active', 'inactive', 'deprecated'].includes(status)) {
    toast('Status is invalid.', true);
    return;
  }

  const session = await getSession();
  const payload = {
    name,
    platforms,
    audience,
    owner_contact: ownerContact,
    reference_url: referenceUrl,
    app_store_url: appStoreUrl,
    status,
    notes
  };
  if (!id) {
    payload.created_by_user_id = session?.user?.id || null;
    payload.updated_by_user_id = session?.user?.id || null;
  } else {
    payload.updated_by_user_id = session?.user?.id || null;
  }

  let error = null;
  if (id) {
    const result = await supabase
      .from('applications')
      .update(payload)
      .eq('id', id);
    error = result.error;
  } else {
    const result = await supabase
      .from('applications')
      .insert(payload);
    error = result.error;
  }

  if (error) {
    toast(error.message || 'Failed to save application.', true);
    return;
  }

  toast('Application saved.');
  resetForm();
  await loadApplications();
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

  currentProfile = await getCurrentProfile();
  if (!currentProfile || !moduleCanView(currentProfile, 'applications')) {
    toast('Applications access required.', true);
    window.location.href = './index.html';
    return;
  }

  setRoleVisibility(currentProfile.role || 'viewer');
  applyModuleVisibility(currentProfile);
  initAdminNav();

  if (applicationsLoadingPanel) applicationsLoadingPanel.hidden = true;
  if (applicationsTopbar) applicationsTopbar.hidden = false;
  if (applicationsNav) applicationsNav.hidden = false;
  if (applicationsMainSection) applicationsMainSection.hidden = false;

  loadSiteBrandingFromServer({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh
  }).catch(() => {});
  stopConnectionBadgeMonitor = initConnectionBadgeMonitor({
    supabaseClient: supabase,
    ensureSessionFreshFn: ensureSessionFresh,
    badgeSelector: '#connectionBadge'
  });

  applyEditMode();
  decoratePlatformChipSet(applicationPlatformChips);
  decoratePlatformChipSet(applicationPlatformFilterChips);
  bindChipPicker(applicationPlatformChips, selectedApplicationPlatforms);
  bindChipPicker(applicationPlatformFilterChips, selectedPlatformFilters, applyTableFilters);
  setApplicationFormOpen(false);
  resetForm();
  await loadApplications();

  saveApplicationBtn?.addEventListener('click', () => {
    saveApplication().catch((err) => toast(err.message, true));
  });
  clearApplicationBtn?.addEventListener('click', () => resetForm());
  deleteApplicationBtn?.addEventListener('click', () => {
    const id = String(qs('#applicationId')?.value || '').trim();
    if (!id) return;
    const row = allApplications.find((item) => String(item.id) === id);
    const name = row?.name || 'Unknown';
    const ok = window.confirm(`Delete application "${name}"?`);
    if (!ok) return;
    deleteApplication(id).catch((err) => toast(err.message || 'Failed to delete application.', true));
  });
  toggleApplicationFormBtn?.addEventListener('click', () => {
    if (!moduleCanEdit(currentProfile, 'applications')) {
      toast('Applications edit access required.', true);
      return;
    }
    setApplicationFormOpen(!isApplicationFormOpen, { focusName: !isApplicationFormOpen });
  });
  refreshApplicationsBtn?.addEventListener('click', () => {
    loadApplications().catch((err) => toast(err.message, true));
  });
  applicationsImportBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!moduleCanEdit(currentProfile, 'applications')) {
      toast('Applications edit access required.', true);
      return;
    }
    setApplicationsImportMenuOpen(Boolean(applicationsImportMenu?.hidden));
  });
  importApplicationsCsvBtn?.addEventListener('click', () => {
    setApplicationsImportMenuOpen(false);
    if (!moduleCanEdit(currentProfile, 'applications')) {
      toast('Applications edit access required.', true);
      return;
    }
    importApplicationsFile?.click();
  });
  downloadApplicationsTemplateBtn?.addEventListener('click', () => {
    setApplicationsImportMenuOpen(false);
    downloadApplicationsImportTemplate();
  });
  exportApplicationsCsvBtn?.addEventListener('click', () => {
    setApplicationsImportMenuOpen(false);
    exportApplicationsCsv();
  });
  importApplicationsFile?.addEventListener('change', (event) => {
    handleApplicationsImportFileSelection(event).catch((err) => toast(err.message || 'Import failed.', true));
  });
  applicationSearchInput?.addEventListener('input', applyTableFilters);
  applicationStatusFilter?.addEventListener('change', applyTableFilters);
  applicationAudienceFilter?.addEventListener('change', applyTableFilters);
  document.addEventListener('click', (event) => {
    const target = event?.target;
    const inPopover = target && target.closest && target.closest('#applicationsImportPopover');
    if (!inPopover) setApplicationsImportMenuOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setApplicationsImportMenuOpen(false);
  });
  window.addEventListener('resize', () => {
    if (applicationsImportMenu && !applicationsImportMenu.hidden) {
      positionApplicationsImportMenu();
    }
  });
  await loadPeople();
  window.addEventListener('beforeunload', () => {
    if (stopConnectionBadgeMonitor) stopConnectionBadgeMonitor();
  });
}

init().catch((err) => {
  if (applicationsLoadingPanel) applicationsLoadingPanel.hidden = true;
  if (applicationsTopbar) applicationsTopbar.hidden = false;
  if (applicationsNav) applicationsNav.hidden = false;
  if (applicationsMainSection) applicationsMainSection.hidden = false;
  if (applicationsAccessHint) {
    applicationsAccessHint.textContent = `Initialization error: ${err.message || 'Unknown error'}`;
  }
  toast(err.message || 'Failed to initialize Applications page.', true);
});
