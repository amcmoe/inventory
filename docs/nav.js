(function () {
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
  <a href="./"><span>Search</span></a>
  <div class="nav-group nav-group-admin" data-role-min="admin">
    <button class="nav-group-toggle" type="button" aria-expanded="false">
      <span>Admin</span>
      <span class="nav-caret" aria-hidden="true">&#9662;</span>
    </button>
    <div class="nav-submenu">
      <a class="nav-subitem" href="./admin.html"><span>Asset Management</span></a>
      <a class="nav-subitem" href="./people.html"><span>User Management</span></a>
      <a class="nav-subitem" href="./site-settings.html"><span>Site Settings</span></a>
    </div>
  </div>
  <div class="nav-group nav-group-reports">
    <button class="nav-group-toggle" type="button" aria-expanded="false">
      <span>Reports</span>
      <span class="nav-caret" aria-hidden="true">&#9662;</span>
    </button>
    <div class="nav-submenu">
      <a class="nav-subitem" href="./kpi-reports.html"><span>KPI Reports</span></a>
      <a class="nav-subitem" href="./reports.html"><span>Report Builder</span></a>
      <a class="nav-subitem" href="./user-reports.html"><span>User Reports</span></a>
    </div>
  </div>
</nav>
<div class="sidebar-footer"></div>`;

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
      'admin.html':            { href: './admin.html',             group: 'nav-group-admin' },
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
