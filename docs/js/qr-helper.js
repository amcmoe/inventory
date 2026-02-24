import { supabase, ROLES, requireConfig } from './supabase-client.js';
import { getSession, getCurrentProfile, requireAuth } from './auth.js';
import { qs, toast, escapeHtml, setRoleVisibility } from './ui.js';

const qrTopbar = qs('#qrTopbar');
const qrNav = qs('#qrNav');
const qrLoadingPanel = qs('#qrLoadingPanel');
const qrMainSection = qs('#qrMainSection');
const qrOutputSection = qs('#qrOutputSection');

function defaultBaseUrl() {
  const base = window.location.origin + window.location.pathname.replace(/qr-helper\.html$/, 'asset.html?tag=');
  return base;
}

async function generate() {
  const baseUrl = qs('#baseUrl').value.trim();
  const tags = qs('#tagList').value
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);

  if (!baseUrl || !tags.length) {
    toast('Enter base URL and at least one tag.', true);
    return;
  }

  const output = qs('#qrOutput');
  output.innerHTML = '';

  for (const tag of tags) {
    const url = `${baseUrl}${encodeURIComponent(tag)}`;
    const container = document.createElement('div');
    container.className = 'panel';

    const canvasId = `qr-${Math.random().toString(36).slice(2)}`;
    container.innerHTML = `
      <div><strong>${escapeHtml(tag)}</strong></div>
      <div class="meta"><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a></div>
      <canvas id="${canvasId}" style="margin-top:8px;"></canvas>
    `;
    output.appendChild(container);

    await window.QRCode.toCanvas(document.getElementById(canvasId), url, {
      width: 180,
      margin: 1
    });
  }
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
    toast('Tech/Admin role required for QR helper.', true);
    window.location.href = './index.html';
    return;
  }

  if (qrLoadingPanel) qrLoadingPanel.hidden = true;
  if (qrTopbar) {
    qrTopbar.hidden = false;
    qrTopbar.style.display = '';
  }
  if (qrNav) {
    qrNav.hidden = false;
    qrNav.style.display = '';
  }
  if (qrMainSection) qrMainSection.hidden = false;
  if (qrOutputSection) qrOutputSection.hidden = false;

  qs('#baseUrl').value = defaultBaseUrl();
  qs('#generateBtn').addEventListener('click', generate);
}

init().catch((err) => toast(err.message, true));
