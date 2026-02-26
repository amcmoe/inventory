import { supabase, ROLES, roleCanWrite, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth, signOut } from './auth.js';
import { qs, toast, formatDateTime, escapeHtml, setRoleVisibility, initTheme, bindThemeToggle, bindSignOut } from './ui.js';

const bucket = 'asset-damage-photos';

const assetTitle = qs('#assetTitle');
const assetMeta = qs('#assetMeta');
const historyList = qs('#historyList');
const damageList = qs('#damageList');

const checkoutDialog = qs('#checkoutDialog');
const damageDialog = qs('#damageDialog');
const assetTopbar = qs('#assetTopbar');
const assetNav = qs('#assetNav');
const assetLoadingPanel = qs('#assetLoadingPanel');
const historySection = qs('#historySection');
const damageSection = qs('#damageSection');

let session = null;
let profile = null;
let asset = null;
let selectedPerson = null;
let personSearchDebounce = null;
let incidentCount = 0;

function getTag() {
  const params = new URLSearchParams(window.location.search);
  return params.get('tag');
}

function statusBadge(status) {
  return `<span class="badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function detailPill(label, value) {
  return `
    <div class="detail-pill">
      <div class="detail-label">${label}</div>
      <div class="detail-value">${value}</div>
    </div>
  `;
}

function inServiceFor(startDate) {
  if (!startDate) {
    return '-';
  }
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return '-';
  }
  const now = new Date();
  const days = Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
  if (days < 30) {
    return `${days} day(s)`;
  }
  const months = Math.floor(days / 30);
  if (months < 24) {
    return `${months} month(s)`;
  }
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return `${years} year(s) ${remMonths} month(s)`;
}

async function loadAsset() {
  const tag = getTag();
  if (!tag) {
    assetTitle.textContent = 'Asset tag is required in URL.';
    return;
  }

  const { data, error } = await supabase
    .from('assets')
    .select('id, asset_tag, serial, device_name, manufacturer, model, equipment_type, location, building, room, service_start_date, asset_condition, comments, ownership, warranty_expiration_date, obsolete, status, notes, asset_current(assignee_person_id, checked_out_at, people(id, display_name, email, employee_id, department))')
    .eq('asset_tag', tag)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    assetTitle.textContent = `Asset not found: ${tag}`;
    return;
  }

  asset = data;

  const current = Array.isArray(asset.asset_current) ? asset.asset_current[0] : asset.asset_current;
  const assignee = current?.people?.display_name || '-';

  const title = asset.model || asset.device_name || asset.asset_tag;
  assetTitle.innerHTML = `${escapeHtml(asset.asset_tag)} - ${escapeHtml(title)}`;
  const assignmentHistory = asset.comments
    ? escapeHtml(asset.comments).replaceAll('\n', '<br>')
    : '<span class="muted">No assignment history yet.</span>';
  const conditionNotes = asset.notes
    ? escapeHtml(asset.notes).replaceAll('\n', '<br>')
    : '<span class="muted">No condition notes.</span>';

  assetMeta.innerHTML = `
    <div class="asset-detail-head">
      <div class="detail-status-wrap">
        <span class="detail-label">Status</span>
        ${statusBadge(asset.status)}
      </div>
    </div>
    <div class="asset-detail-grid">
      ${detailPill('Serial', escapeHtml(asset.asset_tag))}
      ${detailPill('Manufacturer', escapeHtml(asset.manufacturer || '-'))}
      ${detailPill('Model', escapeHtml(asset.model || '-'))}
      ${detailPill('Equipment Type', escapeHtml(asset.equipment_type || '-'))}
      ${detailPill('Building', escapeHtml(asset.building || '-'))}
      ${detailPill('Room', escapeHtml(asset.room || '-'))}
      ${detailPill('Location', escapeHtml(asset.location || '-'))}
      ${detailPill('In Service Since', escapeHtml(asset.service_start_date || '-'))}
      ${detailPill('In Service For', escapeHtml(inServiceFor(asset.service_start_date)))}
      ${detailPill('Condition', escapeHtml(asset.asset_condition || '-'))}
      ${detailPill('Incidents', escapeHtml(String(incidentCount)))}
      ${detailPill('Ownership', escapeHtml(asset.ownership || '-'))}
      ${detailPill('Warranty Expires', escapeHtml(asset.warranty_expiration_date || '-'))}
      ${detailPill('Obsolete', asset.obsolete ? 'Yes' : 'No')}
      ${detailPill('Current Assignee', escapeHtml(assignee))}
      ${detailPill('Checked Out At', formatDateTime(current?.checked_out_at))}
    </div>
    <div class="asset-detail-notes">
      <div class="detail-block">
        <div class="detail-label">Assignment History</div>
        <div class="detail-text">${assignmentHistory}</div>
      </div>
      <div class="detail-block">
        <div class="detail-label">Condition Notes</div>
        <div class="detail-text">${conditionNotes}</div>
      </div>
    </div>
  `;

  qs('#checkoutBtn').disabled = asset.status !== 'available';
  qs('#checkinBtn').disabled = asset.status !== 'checked_out';
}

async function loadHistory() {
  if (!asset) {
    return;
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('id, action, assignee_person_id, performed_by_user_id, occurred_at, notes, due_date, people(display_name)')
    .eq('asset_id', asset.id)
    .order('occurred_at', { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  if (!data?.length) {
    historyList.innerHTML = '<div class="muted">No transactions yet.</div>';
    return;
  }

  historyList.innerHTML = data.map((tx) => {
    const assignee = tx.people?.display_name || '-';
    return `
      <div class="history-item">
        <div class="row row-between">
          <strong>${tx.action.toUpperCase()}</strong>
          <span class="muted">${formatDateTime(tx.occurred_at)}</span>
        </div>
        <div class="meta">Assignee: ${escapeHtml(assignee)}</div>
        <div class="meta">Due: ${escapeHtml(tx.due_date || '-')}</div>
        <div class="meta">By user ID: ${escapeHtml(tx.performed_by_user_id)}</div>
        <div class="meta">Notes: ${escapeHtml(tx.notes || '-')}</div>
      </div>
    `;
  }).join('');
}

async function loadDamageReports() {
  if (!asset) {
    return;
  }

  const { data, error } = await supabase
    .from('damage_reports')
    .select('id, status, summary, notes, created_at, reported_by_user_id, related_transaction_id, damage_photos(id, storage_path, caption, created_at)')
    .eq('asset_id', asset.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  if (!data?.length) {
    incidentCount = 0;
    damageList.innerHTML = '<div class="muted">No damage reports for this asset.</div>';
    if (asset) {
      await loadAsset();
    }
    return;
  }
  incidentCount = data.length;

  const allPaths = data.flatMap((report) => (report.damage_photos || []).map((p) => p.storage_path));
  let signedMap = new Map();

  if (allPaths.length) {
    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrls(allPaths, 3600);

    if (!signedError && signedData) {
      signedData.forEach((item, index) => {
        signedMap.set(allPaths[index], item.signedUrl);
      });
    }
  }

  damageList.innerHTML = data.map((report) => {
    const photos = report.damage_photos || [];
    const photoHtml = photos.length
      ? `<div class="thumb-grid">${photos.map((photo) => {
        const url = signedMap.get(photo.storage_path);
        if (!url) {
          return '';
        }
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(url)}" alt="Damage photo"></a>`;
      }).join('')}</div>`
      : '<div class="muted">No photos uploaded.</div>';

    return `
      <div class="damage-item">
        <div class="row row-between">
          <strong>${escapeHtml(report.summary)}</strong>
          <span class="badge status-${escapeHtml(report.status)}">${escapeHtml(report.status)}</span>
        </div>
        <div class="meta">Created: ${formatDateTime(report.created_at)} | Reporter: ${escapeHtml(report.reported_by_user_id)}</div>
        <div class="meta">Related Transaction: ${escapeHtml(String(report.related_transaction_id || '-'))}</div>
        <div class="meta">Notes: ${escapeHtml(report.notes || '-')}</div>
        ${photoHtml}
      </div>
    `;
  }).join('');
  if (asset) {
    await loadAsset();
  }
}

async function searchPeople(term) {
  if (!term || term.length < 2) {
    qs('#assigneeSuggestions').hidden = true;
    return;
  }

  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, email, employee_id, department')
    .ilike('display_name', `%${term}%`)
    .order('display_name', { ascending: true })
    .limit(8);

  if (error) {
    toast(error.message, true);
    return;
  }

  const container = qs('#assigneeSuggestions');
  if (!data?.length) {
    container.innerHTML = '<div class="suggestion muted">No match found.</div>';
    container.hidden = false;
    qs('#createPersonBtn').hidden = profile.role !== ROLES.ADMIN;
    return;
  }

  qs('#createPersonBtn').hidden = true;
  container.innerHTML = data.map((person) => `
    <div class="suggestion" data-person-id="${person.id}" data-name="${escapeHtml(person.display_name)}">
      <strong>${escapeHtml(person.display_name)}</strong><br>
      <span class="muted">${escapeHtml(person.email || person.employee_id || '-')}</span>
    </div>
  `).join('');
  container.hidden = false;

  container.querySelectorAll('.suggestion[data-person-id]').forEach((node) => {
    node.addEventListener('click', () => {
      const person = data.find((p) => p.id === node.getAttribute('data-person-id'));
      if (!person) {
        return;
      }
      selectedPerson = person;
      qs('#assigneeSearch').value = person.display_name;
      qs('#assigneeSelected').textContent = `Selected: ${person.display_name}`;
      container.hidden = true;
    });
  });
}

async function createPersonFromPrompt() {
  const name = window.prompt('New person display name:');
  if (!name) {
    return;
  }

  const email = window.prompt('Email (optional):') || null;
  const employeeId = window.prompt('Employee ID (optional):') || null;
  const department = window.prompt('Department (optional):') || null;

  const { data, error } = await supabase.rpc('admin_create_person', {
    p_display_name: name,
    p_email: email,
    p_employee_id: employeeId,
    p_department: department
  });

  if (error) {
    toast(error.message, true);
    return;
  }

  selectedPerson = data;
  qs('#assigneeSearch').value = data.display_name;
  qs('#assigneeSelected').textContent = `Selected: ${data.display_name}`;
  qs('#createPersonBtn').hidden = true;
  toast('Person created.');
}

async function doCheckout() {
  if (!selectedPerson?.id) {
    toast('Select an assignee first.', true);
    return;
  }

  const dueDate = qs('#dueDate').value || null;
  const notes = qs('#checkoutNotes').value.trim() || null;

  const { error } = await supabase.rpc('checkout_asset', {
    p_asset_tag: asset.asset_tag,
    p_assignee_person_id: selectedPerson.id,
    p_due_date: dueDate,
    p_notes: notes
  });

  if (error) {
    toast(error.message, true);
    return;
  }

  checkoutDialog.hidden = true;
  qs('#checkoutNotes').value = '';
  toast('Asset checked out.');
  await refreshAll();
}

async function doCheckin() {
  const notes = window.prompt('Check-in notes (optional):') || null;

  const { error } = await supabase.rpc('checkin_asset', {
    p_asset_tag: asset.asset_tag,
    p_notes: notes
  });

  if (error) {
    toast(error.message, true);
    return;
  }

  toast('Asset checked in.');
  await refreshAll();
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function submitDamageReport() {
  const summary = qs('#damageSummary').value.trim();
  const notes = qs('#damageNotes').value.trim() || null;
  const files = Array.from(qs('#damagePhotos').files || []);

  if (!summary) {
    toast('Summary is required.', true);
    return;
  }

  const { data: report, error } = await supabase
    .from('damage_reports')
    .insert({
      asset_id: asset.id,
      reported_by_user_id: session.user.id,
      summary,
      notes
    })
    .select('id')
    .single();

  if (error) {
    toast(error.message, true);
    return;
  }

  for (const file of files) {
    const path = `${report.id}/${Date.now()}-${Math.random().toString(36).slice(2)}-${sanitizeFilename(file.name)}`;
    const upload = await supabase.storage.from(bucket).upload(path, file);
    if (upload.error) {
      toast(`Photo upload failed: ${upload.error.message}`, true);
      continue;
    }

    const insertPhoto = await supabase
      .from('damage_photos')
      .insert({
        damage_report_id: report.id,
        storage_path: path
      });

    if (insertPhoto.error) {
      toast(`Photo record failed: ${insertPhoto.error.message}`, true);
    }
  }

  damageDialog.hidden = true;
  qs('#damageSummary').value = '';
  qs('#damageNotes').value = '';
  qs('#damagePhotos').value = '';
  toast('Damage report submitted.');
  await loadDamageReports();
}

async function refreshAll() {
  await loadAsset();
  await loadHistory();
  await loadDamageReports();
}

async function init() {
  initTheme();
  bindThemeToggle();
  bindSignOut(signOut);
  if (!requireConfig()) {
    toast('Update config.js with Supabase config.', true);
    return;
  }

  session = await getSession();
  if (!requireAuth(session)) {
    return;
  }

  profile = await getCurrentProfile();
  setRoleVisibility(profile.role);

  if (assetLoadingPanel) assetLoadingPanel.hidden = true;
  if (assetTopbar) {
    assetTopbar.hidden = false;
    assetTopbar.style.display = '';
  }
  if (assetNav) {
    assetNav.hidden = false;
    assetNav.style.display = '';
  }
  qs('#assetPanel').hidden = false;
  if (historySection) historySection.hidden = false;
  if (damageSection) damageSection.hidden = false;

  if (!roleCanWrite(profile.role)) {
    qs('#actionButtons').hidden = true;
  }

  qs('#refreshBtn').addEventListener('click', refreshAll);

  qs('#checkoutBtn').addEventListener('click', () => {
    checkoutDialog.hidden = false;
  });

  qs('#cancelCheckoutBtn').addEventListener('click', () => {
    checkoutDialog.hidden = true;
  });

  qs('#confirmCheckoutBtn').addEventListener('click', doCheckout);
  qs('#checkinBtn').addEventListener('click', doCheckin);

  qs('#reportDamageBtn').addEventListener('click', () => {
    damageDialog.hidden = false;
  });
  qs('#cancelDamageBtn').addEventListener('click', () => {
    damageDialog.hidden = true;
  });
  qs('#submitDamageBtn').addEventListener('click', submitDamageReport);

  qs('#assigneeSearch').addEventListener('input', (event) => {
    window.clearTimeout(personSearchDebounce);
    personSearchDebounce = window.setTimeout(() => searchPeople(event.target.value.trim()), 180);
  });

  qs('#createPersonBtn').addEventListener('click', createPersonFromPrompt);

  await refreshAll();
}

init().catch((err) => {
  toast(err.message, true);
});

