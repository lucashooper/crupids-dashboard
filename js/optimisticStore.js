import { supabase, supabaseConfigured } from './supabaseClient.js';

const SYNC_DEBOUNCE_MS = 450;
const PREFS_DEBOUNCE_MS = 800;

let cachedUserId = null;
const pendingSync = new Map();
let prefsTimer = null;

function readLocal(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (key.startsWith('goals:')) {
    window.dispatchEvent(new CustomEvent('goals-changed'));
  }
}

function removeLocal(key) {
  localStorage.removeItem(key);
}

function isSyncedDataKey(key) {
  return key.startsWith('goals:') || key === 'habits_v1' || key.startsWith('reflection:');
}

function isPrefKey(key) {
  return !isSyncedDataKey(key);
}

export function storeGet(key) {
  return readLocal(key);
}

export function storeSet(key, value) {
  writeLocal(key, value);
  scheduleSync(key, value);
}

export function storeDelete(key) {
  removeLocal(key);
  scheduleDelete(key);
}

export function storeListKeys(prefix) {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

export function getSyncedUserId() {
  return cachedUserId;
}

export function setSyncedUserId(userId) {
  cachedUserId = userId || null;
}

function scheduleSync(key, value) {
  if (!cachedUserId || !supabaseConfigured || !supabase) return;

  if (isPrefKey(key)) {
    schedulePrefsSync();
    return;
  }

  const prev = pendingSync.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pendingSync.delete(key);
    pushKeyToSupabase(key, value).catch((err) => {
      console.warn('[sync] push failed:', key, err);
    });
  }, SYNC_DEBOUNCE_MS);
  pendingSync.set(key, { timer, value });
}

function scheduleDelete(key) {
  if (!cachedUserId || !supabaseConfigured || !supabase) return;

  if (key.startsWith('goals:')) {
    const taskDate = key.slice('goals:'.length);
    supabase
      .from('tasks')
      .delete()
      .eq('user_id', cachedUserId)
      .eq('task_date', taskDate)
      .then(({ error }) => {
        if (error) console.warn('[sync] delete task failed:', error);
      });
    return;
  }

  if (key.startsWith('reflection:')) {
    const reflectionDate = key.slice('reflection:'.length);
    supabase
      .from('reflections')
      .delete()
      .eq('user_id', cachedUserId)
      .eq('reflection_date', reflectionDate)
      .then(({ error }) => {
        if (error) console.warn('[sync] delete reflection failed:', error);
      });
  }
}

function schedulePrefsSync() {
  if (!cachedUserId || !supabase) return;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    prefsTimer = null;
    pushPrefsBlob().catch((err) => console.warn('[sync] prefs failed:', err));
  }, PREFS_DEBOUNCE_MS);
}

async function pushKeyToSupabase(key, value) {
  if (!cachedUserId || !supabase) return;

  if (key.startsWith('goals:')) {
    const taskDate = key.slice('goals:'.length);
    const { error } = await supabase.from('tasks').upsert(
      {
        user_id: cachedUserId,
        task_date: taskDate,
        goals: value ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,task_date' }
    );
    if (error) throw error;
    return;
  }

  if (key === 'habits_v1') {
    const habits = Array.isArray(value) ? value : [];
    const { error: delErr } = await supabase.from('habits').delete().eq('user_id', cachedUserId);
    if (delErr) throw delErr;
    if (habits.length === 0) return;

    const rows = habits.map((h) => ({
      id: h.id,
      user_id: cachedUserId,
      text: h.text || '',
      history: h.history || {},
      streak: h.streak ?? 0,
      best_streak: h.bestStreak ?? 0,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('habits').upsert(rows, { onConflict: 'user_id,id' });
    if (error) throw error;
    return;
  }

  if (key.startsWith('reflection:')) {
    const reflectionDate = key.slice('reflection:'.length);
    const payload = value || {};
    const toLine = (v) => (Array.isArray(v) ? v.join('\n') : v ?? '');
    const { error } = await supabase.from('reflections').upsert(
      {
        user_id: cachedUserId,
        reflection_date: reflectionDate,
        wins: toLine(payload.wins),
        struggles: toLine(payload.struggles),
        tomorrow: toLine(payload.tomorrow),
        summary: JSON.stringify({
          summary: payload.summary ?? '',
          completedAt: payload.completedAt ?? null,
        }),
        updated_at: payload.updatedAt || new Date().toISOString(),
      },
      { onConflict: 'user_id,reflection_date' }
    );
    if (error) throw error;
  }
}

function collectPrefsBlob() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isPrefKey(k)) {
      data[k] = readLocal(k);
    }
  }
  return data;
}

async function pushPrefsBlob() {
  if (!cachedUserId || !supabase) return;
  const data = collectPrefsBlob();
  const { error } = await supabase.from('user_preferences').upsert(
    {
      user_id: cachedUserId,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

export async function pushAllLocalToSupabase() {
  if (!cachedUserId || !supabase) return;

  const jobs = [];
  storeListKeys('goals:').forEach((key) => {
    jobs.push(pushKeyToSupabase(key, readLocal(key)));
  });
  jobs.push(pushKeyToSupabase('habits_v1', readLocal('habits_v1') || []));
  storeListKeys('reflection:').forEach((key) => {
    jobs.push(pushKeyToSupabase(key, readLocal(key)));
  });
  jobs.push(pushPrefsBlob());
  await Promise.all(jobs);
}

/** Upload existing localStorage only when the user has no cloud rows yet (first device). */
export async function migrateLocalIfCloudEmpty(userId) {
  if (!userId || !supabase) return;
  const { count, error } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) {
    console.warn('[sync] cloud check failed:', error);
    return;
  }
  if ((count ?? 0) > 0) return;
  cachedUserId = userId;
  await pushAllLocalToSupabase();
}

export async function hydrateFromSupabase(userId) {
  if (!userId || !supabaseConfigured || !supabase) return;

  const [tasksRes, habitsRes, reflRes, prefsRes] = await Promise.all([
    supabase.from('tasks').select('task_date, goals, updated_at').eq('user_id', userId),
    supabase.from('habits').select('id, text, history, streak, best_streak, updated_at').eq('user_id', userId),
    supabase
      .from('reflections')
      .select('reflection_date, wins, struggles, tomorrow, summary, updated_at')
      .eq('user_id', userId),
    supabase.from('user_preferences').select('data').eq('user_id', userId).maybeSingle(),
  ]);

  if (tasksRes.error) throw tasksRes.error;
  if (habitsRes.error) throw habitsRes.error;
  if (reflRes.error) throw reflRes.error;
  if (prefsRes.error) throw prefsRes.error;

  (tasksRes.data || []).forEach((row) => {
    writeLocal(`goals:${row.task_date}`, row.goals || []);
  });

  if (habitsRes.data?.length) {
    const habits = habitsRes.data.map((h) => ({
      id: h.id,
      text: h.text,
      history: h.history || {},
      streak: h.streak ?? 0,
      bestStreak: h.best_streak ?? 0,
    }));
    writeLocal('habits_v1', habits);
  }

  (reflRes.data || []).forEach((r) => {
    let summaryText = r.summary ?? '';
    let completedAt = null;
    try {
      const meta = JSON.parse(r.summary);
      if (meta && typeof meta === 'object' && 'summary' in meta) {
        summaryText = meta.summary ?? '';
        completedAt = meta.completedAt ?? null;
      }
    } catch {
      /* legacy plain summary string */
    }
    writeLocal(`reflection:${r.reflection_date}`, {
      wins: r.wins ?? '',
      struggles: r.struggles ?? '',
      tomorrow: r.tomorrow ?? '',
      summary: summaryText,
      completedAt,
      updatedAt: r.updated_at,
    });
  });

  const prefs = prefsRes.data?.data;
  if (prefs && typeof prefs === 'object') {
    Object.entries(prefs).forEach(([k, v]) => writeLocal(k, v));
  }

  window.dispatchEvent(new CustomEvent('data-hydrated'));
}

export async function handleAuthSessionEvent(event, session) {
  if (!supabaseConfigured || !supabase) return;

  const uid = session?.user?.id ?? null;
  cachedUserId = uid;

  if (
    uid &&
    (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')
  ) {
    await hydrateFromSupabase(uid);
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
      window.dispatchEvent(new CustomEvent('data-hydrated'));
    }
  }
}
