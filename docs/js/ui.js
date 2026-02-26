export function qs(selector) {
  return document.querySelector(selector);
}

export function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

export function toast(message, isError = false) {
  const el = document.createElement('div');
  el.className = `toast ${isError ? 'error' : 'ok'}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 30);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

export function formatDateTime(value) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function escapeHtml(value) {
  return (value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function setRoleVisibility(role) {
  document.querySelectorAll('[data-role-min]').forEach((el) => {
    const minRole = el.getAttribute('data-role-min');
    const allowed =
      minRole === 'viewer' ||
      (minRole === 'tech' && (role === 'tech' || role === 'admin')) ||
      (minRole === 'admin' && role === 'admin');
    el.hidden = !allowed;
  });
}

export function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
}

export function bindThemeToggle() {
  const btn = document.querySelector('#themeBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
}

export function bindSignOut(signOutFn, redirectUrl = './index.html') {
  const btn = document.querySelector('#signOutBtn');
  if (!btn || typeof signOutFn !== 'function') return;
  btn.addEventListener('click', async () => {
    try {
      await signOutFn();
      window.location.href = redirectUrl;
    } catch (err) {
      toast(err?.message || 'Sign out failed.', true);
    }
  });
}
