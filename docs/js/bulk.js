import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility } from './ui.js';

const bulkTopbar = qs('#bulkTopbar');
const bulkNav = qs('#bulkNav');
const bulkLoadingPanel = qs('#bulkLoadingPanel');
const bulkMainSection = qs('#bulkMainSection');
const bulkResultsSection = qs('#bulkResultsSection');

let selectedPerson = null;
let debounce = null;

async function searchPeople(term) {
  if (!term || term.length < 2) {
    qs('#assigneeSuggestions').hidden = true;
    return;
  }

  const { data, error } = await supabase
    .from('people')
    .select('id, display_name, email, employee_id')
    .ilike('display_name', `%${term}%`)
    .order('display_name')
    .limit(8);

  if (error) {
    toast(error.message, true);
    return;
  }

  const box = qs('#assigneeSuggestions');
  if (!data?.length) {
    box.innerHTML = '<div class="suggestion muted">No match found</div>';
    box.hidden = false;
    return;
  }

  box.innerHTML = data.map((p) => `
    <div class="suggestion" data-id="${p.id}">
      <strong>${escapeHtml(p.display_name)}</strong><br>
      <span class="muted">${escapeHtml(p.email || p.employee_id || '-')}</span>
    </div>
  `).join('');
  box.hidden = false;

  box.querySelectorAll('.suggestion[data-id]').forEach((node) => {
    node.addEventListener('click', () => {
      selectedPerson = data.find((p) => p.id === node.getAttribute('data-id'));
      qs('#assigneeSearch').value = selectedPerson.display_name;
      qs('#assigneeSelected').textContent = `Selected: ${selectedPerson.display_name}`;
      box.hidden = true;
    });
  });
}

function addResultRow(tag, ok, details) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${escapeHtml(tag)}</td>
    <td>${ok ? 'Success' : 'Error'}</td>
    <td>${escapeHtml(details)}</td>
  `;
  qs('#resultsBody').appendChild(tr);
}

async function submitBulk() {
  if (!selectedPerson?.id) {
    toast('Select an assignee first.', true);
    return;
  }

  const tags = qs('#assetTags').value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!tags.length) {
    toast('Add at least one asset tag.', true);
    return;
  }

  const dueDate = qs('#dueDate').value || null;
  const notes = qs('#notes').value.trim() || null;

  for (const tag of tags) {
    const { error } = await supabase.rpc('checkout_asset', {
      p_asset_tag: tag,
      p_assignee_person_id: selectedPerson.id,
      p_due_date: dueDate,
      p_notes: notes
    });

    if (error) {
      addResultRow(tag, false, error.message);
      continue;
    }

    addResultRow(tag, true, 'Checked out');
  }

  toast('Bulk checkout finished.');
}

async function init() {
  if (!requireConfig()) {
    toast('Update config.js with Supabase config.', true);
    return;
  }

  const session = await getSession();
  if (!requireAuth(session)) {
    return;
  }

  const profile = await getCurrentProfile();
  setRoleVisibility(profile.role);

  if (!(profile.role === ROLES.ADMIN || profile.role === ROLES.TECH)) {
    toast('Tech/Admin role required for bulk checkout.', true);
    window.location.href = './index.html';
    return;
  }

  if (bulkLoadingPanel) bulkLoadingPanel.hidden = true;
  if (bulkTopbar) {
    bulkTopbar.hidden = false;
    bulkTopbar.style.display = '';
  }
  if (bulkNav) {
    bulkNav.hidden = false;
    bulkNav.style.display = '';
  }
  if (bulkMainSection) bulkMainSection.hidden = false;
  if (bulkResultsSection) bulkResultsSection.hidden = false;

  qs('#assigneeSearch').addEventListener('input', (event) => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => searchPeople(event.target.value.trim()), 180);
  });

  qs('#submitBulkBtn').addEventListener('click', submitBulk);
  qs('#clearResultsBtn').addEventListener('click', () => {
    qs('#resultsBody').innerHTML = '';
  });
}

init().catch((err) => toast(err.message, true));
