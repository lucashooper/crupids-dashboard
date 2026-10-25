import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

// Local-only mode (default): no sign-in, data stays in this browser's localStorage.
// Set VITE_LOCAL_ONLY=false to re-enable Supabase login + cloud sync.
export const localOnly = import.meta.env.VITE_LOCAL_ONLY !== 'false';

export const supabaseConfigured = !localOnly && Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    })
  : null;

export function getUserId() {
  return supabase?.auth.getSession().then(({ data }) => data.session?.user?.id ?? null);
}
