(function () {
  // ── Inline Lucide icons (stroke-only, 24x24 viewBox) ──────────────────────
  const IC = {
    search:     `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    shield:     `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    package:    `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    appWindow:  `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="14" x2="16" y2="14"/></svg>`,
    users:      `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    sliders:    `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
    barChart:   `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    trending:   `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    table:      `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>`,
    userCheck:  `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>`,
  };

  // ── Shared sidebar HTML (single source of truth for navigation) ───────────
  const SIDEBAR_HTML = `
<div class="brand">
  <div class="logo itam-logo" aria-hidden="true">
    <span class="itam-row itam-row-top"><span class="itam-i" aria-hidden="true"></span><span>T</span></span>
    <span class="itam-row itam-row-bottom"><span>A</span><span>M</span></span>
  </div>
  <div class="title">
    <strong>IT Asset Management</strong>
    <span>SMSD Tech Team</span>
  </div>
</div>
<nav class="nav" aria-label="Primary" id="sidebarNav" hidden>
  <a href="./" data-module="inventory" data-module-min="view">${IC.search}<span>Search</span></a>
  <a href="./admin.html" data-role-min="admin" data-module="inventory" data-module-min="edit">${IC.package}<span>Asset Management</span></a>
  <a href="./applications.html" data-module="applications" data-module-min="view">${IC.appWindow}<span>Application Management</span></a>
  <div class="nav-group nav-group-admin" data-role-min="admin" data-module="inventory" data-module-min="edit">
    <button class="nav-group-toggle" type="button" aria-expanded="false">
      <span class="nav-group-label">${IC.shield}<span>Admin</span></span>
      <span class="nav-caret" aria-hidden="true">&#9662;</span>
    </button>
    <div class="nav-submenu">
      <a class="nav-subitem" href="./people.html" data-module="inventory" data-module-min="edit">${IC.users}<span>User Management</span></a>
      <a class="nav-subitem" href="./site-settings.html" data-module="inventory" data-module-min="edit">${IC.sliders}<span>Site Settings</span></a>
    </div>
  </div>
  <div class="nav-group nav-group-reports" data-module="inventory" data-module-min="view">
    <button class="nav-group-toggle" type="button" aria-expanded="false">
      <span class="nav-group-label">${IC.barChart}<span>Reports</span></span>
      <span class="nav-caret" aria-hidden="true">&#9662;</span>
    </button>
    <div class="nav-submenu">
      <a class="nav-subitem" href="./kpi-reports.html" data-module="inventory" data-module-min="view">${IC.trending}<span>KPI Reports</span></a>
      <a class="nav-subitem" href="./reports.html" data-module="inventory" data-module-min="view">${IC.table}<span>Report Builder</span></a>
      <a class="nav-subitem" href="./user-reports.html" data-module="inventory" data-module-min="view">${IC.userCheck}<span>User Reports</span></a>
    </div>
  </div>
</nav>
<div class="sidebar-footer">
  <button class="sidebar-footer-btn" id="recentActivityBtn" type="button">
    <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    <span>Recent Activity</span>
  </button>
</div>`;

  // ── Inject sidebar into the page ──────────────────────────────────────────
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.innerHTML = SIDEBAR_HTML;
    applyActiveState();
  }

  // ── Set active link and pin the correct group based on current page ───────
  function applyActiveState() {
    const file = window.location.pathname.split('/').pop() || 'index.html';
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;

    const PAGE_MAP = {
      'index.html':            { href: './',                        group: null },
      'applications.html':     { href: './applications.html',       group: null },
      'admin.html':            { href: './admin.html',             group: null },
      'people.html':           { href: './people.html',            group: 'nav-group-admin' },
      'site-settings.html': { href: './site-settings.html', group: 'nav-group-admin' },
      'kpi-reports.html':      { href: './kpi-reports.html',       group: 'nav-group-reports' },
      'reports.html':          { href: './reports.html',           group: 'nav-group-reports' },
      'user-reports.html':     { href: './user-reports.html',      group: 'nav-group-reports' },
    };

    const config = PAGE_MAP[file];
    if (!config) return;

    // Mark the active link
    const link = nav.querySelector(`a[href="${config.href}"]`);
    if (link) link.classList.add('active');

    // Pin the parent group (initAdminNav reads data-open-default to set is-pinned)
    if (config.group) {
      const group = nav.querySelector(`.${config.group}`);
      if (group) {
        group.dataset.openDefault = 'true';
        const toggle = group.querySelector('.nav-group-toggle');
        if (toggle) toggle.classList.add('active');
      }
    }
  }

  // ── Hamburger toggle ──────────────────────────────────────────────────────
  const btn = document.getElementById('sidebarToggleBtn');
  const overlay = document.getElementById('sidebarOverlay');
  if (!btn || !sidebar || !overlay) return;

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', 'Close navigation');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open navigation');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  overlay.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
  });
})();
