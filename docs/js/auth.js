import { supabase, ROLES } from './supabase-client.js';

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function sendMagicLink(email) {
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo
    }
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

export async function getCurrentProfile() {
  const session = await getSession();
  if (!session?.user?.id) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, role, display_name')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      user_id: session.user.id,
      role: ROLES.VIEWER,
      display_name: session.user.email || 'User'
    };
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
