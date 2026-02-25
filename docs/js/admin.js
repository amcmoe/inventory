import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth } from './auth.js';
import { qs, toast } from './ui.js';

const adminLoadingPanel = qs('#adminLoadingPanel');
const adminTopbar = qs('#adminTopbar');
const assetAdminSection = qs('#assetAdminSection');
const peopleAdminSection = qs('#peopleAdminSection');
const adminNav = qs('#adminNav');
const existingAssetExtras = qs('#existingAssetExtras');

const knownManufacturers = ['Apple', 'Dell', 'Lenovo', 'HP', 'Beelink'];
let currentProfile = null;

function currentManufacturerValue() {
  const selected = qs('#manufacturer').value;
  if (selected === '__custom__') {
    return qs('#manufacturerCustom').value.trim() || null;
  }
  return selected || null;
}

function syncManufacturerInput() {
  const showCustom = qs('#manufacturer').value === '__custom__';
  qs('#manufacturerCustom').hidden = !showCustom;
}

function setManufacturerValue(value) {
  if (!value) {
    qs('#manufacturer').value = '';
    qs('#manufacturerCustom').value = '';
    qs('#manufacturerCustom').hidden = true;
    return;
  }
  if (knownManufacturers.includes(value)) {
    qs('#manufacturer').value = value;
    qs('#manufacturerCustom').value = '';
    qs('#manufacturerCustom').hidden = true;
    return;
  }
  qs('#manufacturer').value = '__custom__';
  qs('#manufacturerCustom').value = value;
  qs('#manufacturerCustom').hidden = false;
}

function updateEditModeState() {
  const isExisting = Boolean(qs('#assetId').value.trim());
  if (existingAssetExtras) {
    existingAssetExtras.hidden = !isExisting;
  }
}

function buildAssignmentHistory(isExisting) {
  const currentHistory = qs('#comments').value.trim();
  if (!isExisting) {
    return null;
  }

  const assignTo = qs('#assignToName').value.trim();
  if (!assignTo) {
    return currentHistory || null;
  }

  const assignedBy = currentProfile?.display_name || 'Admin';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const entry = `${stamp} - ASSIGNED to ${assignTo} by ${assignedBy}`;
  return currentHistory ? `${currentHistory}\n${entry}` : entry;
}

function getFormValues() {
  const assetId = qs('#assetId').value.trim() || null;
  const isExisting = Boolean(assetId);
  const assetTag = qs('#assetTag').value.trim() || null;
  const equipment = qs('#equipment').value.trim() || null;
  const model = qs('#model').value.trim() || null;
  const derivedDeviceName = equipment || model || assetTag || null;
  return {
    p_id: assetId,
    p_asset_tag: assetTag,
    p_serial: assetTag,
    p_equipment: equipment,
    p_device_name: derivedDeviceName,
    p_manufacturer: currentManufacturerValue(),
    p_model: qs('#model').value.trim() || null,
    p_category: qs('#category').value.trim() || null,
    p_location: null,
    p_building: qs('#building').value.trim() || null,
    p_room: qs('#room').value.trim() || null,
    p_service_start_date: qs('#serviceStartDate').value || null,
    p_asset_condition: qs('#assetCondition').value || null,
    p_comments: buildAssignmentHistory(isExisting),
    p_ownership: qs('#ownership').value || null,
    p_warranty_expiration_date: qs('#warrantyExpirationDate').value || null,
    p_obsolete: isExisting ? qs('#obsolete').value === 'true' : false,
    p_status: isExisting ? qs('#status').value : 'available',
    p_notes: qs('#notes').value.trim() || null
  };
}

function setForm(asset) {
  const editableStatus = ['available', 'repair', 'retired'].includes(asset.status)
    ? asset.status
    : 'available';
  qs('#assetId').value = asset.id || '';
  qs('#assetTag').value = asset.asset_tag || '';
  qs('#equipment').value = asset.equipment || '';
  setManufacturerValue(asset.manufacturer || '');
  qs('#model').value = asset.model || '';
  qs('#category').value = asset.category || '';
  qs('#building').value = asset.building || '';
  qs('#room').value = asset.room || '';
  qs('#serviceStartDate').value = asset.service_start_date || '';
  qs('#assetCondition').value = asset.asset_condition || '';
  qs('#comments').value = asset.comments || '';
  qs('#assignToName').value = '';
  qs('#ownership').value = asset.ownership || '';
  qs('#warrantyExpirationDate').value = asset.warranty_expiration_date || '';
  qs('#obsolete').value = asset.obsolete ? 'true' : 'false';
  qs('#status').value = editableStatus;
  qs('#notes').value = asset.notes || '';
  updateEditModeState();
}

async function saveAsset() {
  const payload = getFormValues();

  const { data, error } = await supabase.rpc('admin_upsert_asset', payload);
  if (error) {
    toast(error.message, true);
    return;
  }

  setForm(data);
  qs('#assignToName').value = '';
  toast('Asset saved.');
}

async function loadByTag() {
  const tag = qs('#assetTag').value.trim();
  if (!tag) {
    toast('Enter a serial number.', true);
    return;
  }

  const { data, error } = await supabase
    .from('assets')
    .select('id, asset_tag, serial, equipment, device_name, manufacturer, model, category, location, building, room, service_start_date, asset_condition, comments, ownership, warranty_expiration_date, obsolete, status, notes')
    .eq('asset_tag', tag)
    .maybeSingle();

  if (error) {
    toast(error.message, true);
    return;
  }

  if (!data) {
    toast('Asset not found for that tag.', true);
    return;
  }

  setForm(data);
  if (data.status === 'checked_out') {
    toast('Checked-out status is managed by checkout/checkin RPC only.');
  }
}

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
  if (!requireConfig()) {
    toast('Update config.js with Supabase config.', true);
    return;
  }

  const session = await getSession();
  if (!requireAuth(session)) {
    return;
  }

  currentProfile = await getCurrentProfile();
  if (currentProfile.role !== ROLES.ADMIN) {
    toast('Admin role required.', true);
    window.location.href = './index.html';
    return;
  }

  if (adminLoadingPanel) {
    adminLoadingPanel.hidden = true;
  }
  if (adminTopbar) {
    adminTopbar.hidden = false;
    adminTopbar.style.display = '';
  }
  if (assetAdminSection) {
    assetAdminSection.hidden = false;
  }
  if (peopleAdminSection) {
    peopleAdminSection.hidden = false;
  }
  if (adminNav) {
    adminNav.hidden = false;
    adminNav.style.display = '';
  }

  qs('#saveAssetBtn').addEventListener('click', saveAsset);
  qs('#loadByTagBtn').addEventListener('click', loadByTag);
  qs('#savePersonBtn').addEventListener('click', createPerson);
  qs('#manufacturer').addEventListener('change', syncManufacturerInput);
  syncManufacturerInput();
  updateEditModeState();
}

init().catch((err) => toast(err.message, true));
