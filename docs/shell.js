/**
 * shell.js — Shared page chrome injector (IIFE, runs before nav.js)
 *
 * For each page, the .topbar element can carry these data attributes:
 *   data-title="Page Title"
 *   data-subtitle="Page subtitle text."
 *   data-has-user-meta        — adds a #userMeta div below the subtitle (index page)
 *   data-no-controls          — skip injecting connection badge + sign-out (qr-scanner)
 *
 * Pages that need extra controls (remote scanner button, etc.) keep a .controls
 * div in the HTML with only their unique elements; shell.js bookends it with the
 * connection badge at the start and the sign-out button at the end.
 *
 * Script load order in each HTML file:
 *   config.js → shell.js → nav.js → [CDN scripts] → [page module]
 */
(function () {
  // ── 1. Sidebar overlay (nav.js needs this by ID) ──────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebarOverlay';
  document.body.appendChild(overlay);

  // ── 2. Theme toggle FAB ───────────────────────────────────────────────────
  const themeBtn = document.createElement('button');
  themeBtn.className = 'theme-toggle-fab';
  themeBtn.id = 'themeBtn';
  themeBtn.type = 'button';
  themeBtn.setAttribute('aria-label', 'Toggle theme');
  themeBtn.innerHTML = '<span class="theme-toggle-glyph" aria-hidden="true"></span>';
  document.body.appendChild(themeBtn);

  // ── 3. Topbar chrome ──────────────────────────────────────────────────────
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;

  // 3a. Hamburger toggle button
  const hamburger = document.createElement('button');
  hamburger.className = 'sidebar-toggle-btn';
  hamburger.id = 'sidebarToggleBtn';
  hamburger.type = 'button';
  hamburger.setAttribute('aria-label', 'Open navigation');
  hamburger.setAttribute('aria-expanded', 'false');
  hamburger.innerHTML = `<svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true"><rect width="18" height="2" rx="1" fill="currentColor"/><rect y="6" width="18" height="2" rx="1" fill="currentColor"/><rect y="12" width="18" height="2" rx="1" fill="currentColor"/></svg>`;
  topbar.insertBefore(hamburger, topbar.firstChild);

  // 3b. Title + subtitle block (from data attributes)
  const title = topbar.dataset.title;
  const subtitle = topbar.dataset.subtitle;
  if (title) {
    const titleBlock = document.createElement('div');
    let inner = `<h1>${title}</h1>`;
    if (subtitle) inner += `<div class="subtext">${subtitle}</div>`;
    if ('hasUserMeta' in topbar.dataset) inner += `<div class="subtext" id="userMeta"></div>`;
    titleBlock.innerHTML = inner;
    hamburger.insertAdjacentElement('afterend', titleBlock);
  }

  // 3c. Connection badge + sign-out button (unless data-no-controls)
  if (!('noControls' in topbar.dataset)) {
    let controls = topbar.querySelector('.controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'controls';
      topbar.appendChild(controls);
    }

    // Connection badge prepended to start of controls
    const badge = document.createElement('span');
    badge.className = 'connection-badge is-reconnecting';
    badge.id = 'connectionBadge';
    badge.setAttribute('aria-live', 'polite');
    badge.setAttribute('title', 'Database status: reconnecting');
    badge.textContent = 'Database';
    controls.insertBefore(badge, controls.firstChild);

    // Sign-out button appended to end of controls
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'btn';
    signOutBtn.id = 'signOutBtn';
    signOutBtn.type = 'button';
    signOutBtn.textContent = 'Log Out';
    controls.appendChild(signOutBtn);
  }
})();
