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
    return;
  }
  document.documentElement.setAttribute('data-theme', 'light');
}

export function bindThemeToggle() {
  const btn = document.querySelector('#themeBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
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

export function initAdminNav() {
  const groups = document.querySelectorAll('.nav-group-admin');
  if (!groups.length) return;

  groups.forEach((group) => {
    const toggle = group.querySelector('.nav-group-toggle');
    if (!toggle || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';

    // Always default to collapsed on load; do not persist in localStorage.
    group.classList.remove('is-pinned');
    toggle.setAttribute('aria-expanded', 'false');

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      const nextPinned = !group.classList.contains('is-pinned');
      group.classList.toggle('is-pinned', nextPinned);
      toggle.setAttribute('aria-expanded', nextPinned ? 'true' : 'false');
    });

    group.addEventListener('mouseenter', () => {
      if (!group.classList.contains('is-pinned')) {
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
    group.addEventListener('mouseleave', () => {
      if (!group.classList.contains('is-pinned')) {
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  });
}

function withTimeout(promise, ms, timeoutMessage = 'Request timed out.') {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(timeoutMessage)), ms);
    Promise.resolve(promise)
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

async function directSupabaseReachabilityCheck(supabaseClient) {
  const url = String(window.APP_CONFIG?.SUPABASE_URL || '').trim();
  const anonKey = String(window.APP_CONFIG?.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return false;
  const headers = { apikey: anonKey };
  const response = await withTimeout(
    fetch(`${url}/rest/v1/assets?select=id&limit=1`, { method: 'GET', headers, cache: 'no-store' }),
    7000,
    'Direct Supabase ping timed out.'
  );
  return response.status < 500;
}

export function initConnectionBadgeMonitor({
  supabaseClient,
  ensureSessionFreshFn,
  badgeSelector = '#connectionBadge',
  pollMs = 15000
} = {}) {
  const badge = typeof badgeSelector === 'string' ? document.querySelector(badgeSelector) : badgeSelector;
  if (!badge || !supabaseClient || typeof ensureSessionFreshFn !== 'function') {
    return () => {};
  }

  let stopped = false;
  let pollTimer = null;
  let reconnectTimer = null;
  let pingInFlight = false;
  let pingQueued = false;
  let lastErrorText = '';
  let badgeState = 'reconnecting';
  let lastConnectedAt = 0;
  const connectedHoldMs = 1500;

  const setBadge = (state = 'connected') => {
    const now = Date.now();
    if (
      (state === 'checking' || state === 'reconnecting') &&
      badgeState === 'connected' &&
      (now - lastConnectedAt) < connectedHoldMs
    ) {
      return;
    }
    badgeState = state;
    if (state === 'connected') {
      lastConnectedAt = now;
    }
    badge.classList.remove('is-connected', 'is-reconnecting', 'is-offline', 'is-checking');
    if (state === 'offline') badge.classList.add('is-offline');
    else if (state === 'checking') badge.classList.add('is-checking');
    else if (state === 'reconnecting') badge.classList.add('is-reconnecting');
    else badge.classList.add('is-connected');

    badge.innerHTML = state === 'reconnecting'
      ? '<span class="connection-label">Database</span><span class="connection-reconnect-dots" aria-hidden="true"><span></span><span></span><span></span></span>'
      : '<span class="connection-label">Database</span>';

    if (state === 'offline') {
      const hint = lastErrorText ? ` (last error: ${lastErrorText})` : '';
      badge.title = `Database connection: offline${hint}`;
      badge.setAttribute('aria-label', 'Database connection: offline');
    } else if (state === 'checking') {
      const hint = lastErrorText ? ` (last error: ${lastErrorText})` : '';
      badge.title = `Database connection: checking${hint}`;
      badge.setAttribute('aria-label', 'Database connection: checking');
    } else if (state === 'reconnecting') {
      const hint = lastErrorText ? ` (last error: ${lastErrorText})` : '';
      badge.title = `Database connection: reconnecting${hint}`;
      badge.setAttribute('aria-label', 'Database connection: reconnecting');
    } else {
      badge.title = 'Database connection: connected';
      badge.setAttribute('aria-label', 'Database connection: connected');
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      window.clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearPollTimer = () => {
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const ping = async () => {
    if (stopped) return false;
    if (pingInFlight) {
      pingQueued = true;
      return false;
    }
    pingInFlight = true;
    try {
      let probeError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const ok = await directSupabaseReachabilityCheck(supabaseClient).catch(() => false);
        if (ok) {
          probeError = null;
          break;
        }
        probeError = new Error('Database ping timed out.');
        if (attempt === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
        }
      }
      if (probeError) throw probeError;
      clearReconnectTimer();
      lastErrorText = '';
      setBadge('connected');
      return true;
    } catch (err) {
      lastErrorText = String(err?.message || err || 'unknown error').slice(0, 140);
      if (!navigator.onLine) {
        clearReconnectTimer();
        setBadge('offline');
      } else {
        startReconnectCountdown();
      }
      return false;
    } finally {
      pingInFlight = false;
      if (pingQueued && !stopped) {
        pingQueued = false;
        window.setTimeout(() => {
          ping().catch(() => {});
        }, 120);
      }
    }
  };

  const schedulePoll = () => {
    if (stopped) return;
    clearPollTimer();
    pollTimer = window.setTimeout(async () => {
      if (document.hidden) {
        clearReconnectTimer();
        setBadge('reconnecting');
        return;
      }
      const ok = await ping();
      if (ok) schedulePoll();
    }, pollMs);
  };

  const startReconnectCountdown = () => {
    if (stopped || document.hidden) {
      clearReconnectTimer();
      setBadge('reconnecting');
      return;
    }
    if (!navigator.onLine) {
      clearReconnectTimer();
      setBadge('offline');
      return;
    }
    if (reconnectTimer) return;
    setBadge('reconnecting');
    reconnectTimer = window.setInterval(async () => {
      if (stopped) {
        clearReconnectTimer();
        return;
      }
      if (!navigator.onLine) {
        clearReconnectTimer();
        setBadge('offline');
        return;
      }
      const ok = await ping();
      if (ok) {
        clearReconnectTimer();
        schedulePoll();
      } else {
        setBadge('reconnecting');
      }
    }, 5000);
  };

  const onVisibility = () => {
    if (document.hidden) {
      clearReconnectTimer();
      setBadge('reconnecting');
      return;
    }
    ping().then((ok) => {
      if (ok) schedulePoll();
    }).catch(() => {});
  };

  const onOnline = () => {
    startReconnectCountdown();
  };

  const onOffline = () => {
    clearReconnectTimer();
    setBadge('offline');
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  if (navigator.onLine) startReconnectCountdown();
  else setBadge('offline');

  return () => {
    stopped = true;
    clearReconnectTimer();
    clearPollTimer();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
