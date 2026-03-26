import { supabase } from './supabase-client.js';

let refreshInFlight = null;

function withTimeout(promise, ms = 5000, timeoutMessage = 'Request timed out.') {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

async function refreshSessionWithTimeout(timeoutMs = 5000) {
  return withTimeout(supabase.auth.refreshSession(), timeoutMs, 'Session refresh timed out.');
}

function isRefreshLockContentionError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    (message.includes('lock') && message.includes('steal')) ||
    message.includes('lock broken by another request') ||
    message.includes('refresh already in progress')
  );
}

function isSessionUsable(session, minRemainingMs = 30_000) {
  if (!session) return false;
  const expMs = Number(session.expires_at || 0) * 1000;
  if (!Number.isFinite(expMs) || expMs <= 0) return true;
  return (expMs - Date.now()) > minRemainingMs;
}

export async function getSession() {
  const { data, error } = await withTimeout(supabase.auth.getSession(), 4500, 'Session lookup timed out.');
  if (error) {
    throw error;
  }
  return data.session;
}

export async function ensureSessionFresh(refreshWindowSec = 180) {
  const session = await getSession();
  if (!session) {
    if (refreshInFlight) {
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      const { data, error } = await refreshSessionWithTimeout(4500);
      if (error) {
        return null;
      }
      return data.session || null;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }
  const expMs = Number(session.expires_at || 0) * 1000;
  const remainingMs = expMs - Date.now();
  if (!Number.isFinite(expMs) || remainingMs > refreshWindowSec * 1000) {
    return session;
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    const { data, error } = await refreshSessionWithTimeout(4500);
    if (error) {
      if (isRefreshLockContentionError(error)) {
        // Another request is refreshing; give it a moment to publish the new token.
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 120 + (attempt * 120)));
          const latestSession = await getSession().catch(() => null);
          if (isSessionUsable(latestSession)) {
            return latestSession;
          }
        }
        const latestSession = await getSession().catch(() => null);
        return latestSession || session;
      }
      throw error;
    }
    return data.session || session;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export function startSessionKeepAlive({ intervalMs = 60_000, refreshWindowSec = 180 } = {}) {
  let timer = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await ensureSessionFresh(refreshWindowSec);
    } catch {
      // Let page-level actions surface auth failures when they occur.
    }
  };

  timer = window.setInterval(tick, intervalMs);
  const onVisible = () => {
    if (!document.hidden) {
      tick().catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if (error) {
    throw error;
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function getCurrentProfile(sessionOverride = null) {
  const session = sessionOverride || await getSession();
  if (!session?.user?.id) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, role, display_name, inventory_access, applications_access, infrastructure_access')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return data;
}

export function requireAuth(session) {
  if (!session) {
    window.location.href = './index.html';
    return false;
  }
  return true;
}
