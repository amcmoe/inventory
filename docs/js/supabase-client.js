import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const appConfig = window.APP_CONFIG || {};

if (!appConfig.SUPABASE_URL || !appConfig.SUPABASE_ANON_KEY) {
  console.warn('Supabase config missing. Update public/config.js');
}

export const supabase = createClient(
  appConfig.SUPABASE_URL || '',
  appConfig.SUPABASE_ANON_KEY || '',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  }
);

export const ROLES = {
  ADMIN: 'admin',
  TECH: 'tech',
  VIEWER: 'viewer'
};

export function roleCanWrite(role) {
  return role === ROLES.ADMIN || role === ROLES.TECH;
}

export function requireConfig() {
  return Boolean(appConfig.SUPABASE_URL && appConfig.SUPABASE_ANON_KEY);
}
