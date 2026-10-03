import { createClient } from '@supabase/supabase-js';

// Default project. The anon key is public by design (RLS protects the data).
// VITE_SUPABASE_* env vars, if set (e.g. in Netlify), override these.
const DEFAULT_SUPABASE_URL = 'https://uemvqqjmvnrtrkpwoovg.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlbXZxcWptdm5ydHJrcHdvb3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0NTY3NzEsImV4cCI6MjA5NzAzMjc3MX0.JqvTcj33-c4aZ2U0WUS9W1s09kHhUEB0dLfE4SI9ZIo';

const url = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
const anonKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  DEFAULT_SUPABASE_ANON_KEY
).trim();

export const supabaseConfigured = Boolean(url && anonKey);

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
