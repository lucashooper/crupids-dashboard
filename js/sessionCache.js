import { supabase } from './supabaseClient.js';

/** In-memory session — avoids getSession() refresh loops after a successful password sign-in. */
let cachedSession = null;

export function setCachedSession(session) {
  cachedSession = session?.access_token ? session : null;
}

export function getCachedSession() {
  return cachedSession;
}

export function clearCachedSession() {
  cachedSession = null;
}

export function isCachedSessionValid(bufferMs = 60_000) {
  if (!cachedSession?.access_token) return false;
  if (!cachedSession.expires_at) return true;
  return cachedSession.expires_at * 1000 > Date.now() + bufferMs;
}

export function restoreClientSession(session = cachedSession) {
  if (!supabase?.auth || !session?.access_token) return Promise.resolve();
  return supabase.auth
    .setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token ?? '',
    })
    .then(({ error }) => {
      if (error) console.warn('[auth] restore session failed:', error.message);
    });
}
