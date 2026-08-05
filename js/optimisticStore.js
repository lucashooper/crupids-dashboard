import { supabase, supabaseConfigured } from './supabaseClient.js';
import { getCachedSession, isCachedSessionValid, restoreClientSession } from './sessionCache.js';

const SYNC_DEBOUNCE_MS = 600;
const PREFS_DEBOUNCE_MS = 2500;

/** Only hydrate / keep this many days of daily rows (tasks + reflections). */
const HYDRATE_PAST_DAYS = 90;
const HYDRATE_FUTURE_DAYS = 14;

/** Cap growing habit history / subtask logs pushed to the cloud. */
const HABIT_HISTORY_KEEP_DAYS = 120;

/**
 * Prefs that are worth multi-device sync. Everything else stays local-only
 * (avoids shipping base64 profile pics, UI tab state, and accumulating day_state_*).
 */
const SYNCED_PREF_KEYS = new Set([
  'stats_v1',
  'dashboard_settings',
  'dashboard_title',
  'goal_streak_v1',
  'best_streak',
]);

let cachedUserId = null;
let syncEnabled = false;
const pendingSync = new Map();
let prefsTimer = null;
let sessionReadyPromise = null;

/** Last successfully pushed snapshots — used to skip unchanged full-collection uploads. */
let lastPushedHabitsJson = null;
let lastPushedLearningJson = null;
let lastPushedPrefsJson = null;
/** Cloud learning ids known after hydrate / last sync (for orphan deletes without full re-read when possible). */
let knownLearningIds = new Set();
let knownHabitIds = new Set();

function readLocal(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('[sync] localStorage write failed:', key, err?.message || err);
    throw err;
  }
  if (key.startsWith('goals:')) {
    window.dispatchEvent(new CustomEvent('goals-changed'));
  }
}

function removeLocal(key) {
  localStorage.removeItem(key);
}

function isSyncedDataKey(key) {
  return (
    key.startsWith('goals:') ||
    key === 'habits_v1' ||
    key === 'learning_log_v1' ||
    key.startsWith('reflection:')
  );
}

function isPrefKey(key) {
  return !isSyncedDataKey(key);
}

function isSyncedPrefKey(key) {
  return SYNCED_PREF_KEYS.has(key);
}

function isoDateOffset(days) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function trimHistoryObject(history, keepDays) {
  if (!history || typeof history !== 'object') return {};
  const cutoff = isoDateOffset(-keepDays);
  const out = {};
  for (const [date, val] of Object.entries(history)) {
    if (date >= cutoff) out[date] = val;
  }
  return out;
}

function habitRowFromLocal(h) {
  return {
    id: h.id,
    user_id: cachedUserId,
    text: h.text || '',
    history: trimHistoryObject(h.history || {}, HABIT_HISTORY_KEEP_DAYS),
    streak: h.streak ?? 0,
    best_streak: h.bestStreak ?? 0,
    subtasks: h.subtasks || [],
    subtask_log: trimHistoryObject(h.subtaskLog || {}, HABIT_HISTORY_KEEP_DAYS),
    emoji: h.emoji || null,
    updated_at: new Date().toISOString(),
  };
}

function stableJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function storeGet(key) {
  return readLocal(key);
}

/** Write localStorage only — never schedules a cloud sync. */
export function storeSetLocal(key, value) {
  writeLocal(key, value);
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
  if (!userId) {
    lastPushedHabitsJson = null;
    lastPushedLearningJson = null;
    lastPushedPrefsJson = null;
    knownLearningIds = new Set();
    knownHabitIds = new Set();
    sessionReadyPromise = null;
  }
}

export function setSyncEnabled(enabled) {
  syncEnabled = enabled;
  if (!enabled) clearPendingSync();
}

export function clearPendingSync() {
  pendingSync.forEach(({ timer }) => clearTimeout(timer));
  pendingSync.clear();
  if (prefsTimer) {
    clearTimeout(prefsTimer);
    prefsTimer = null;
  }
}

async function verifySessionForSync() {
  if (!supabase || !cachedUserId) return false;
  const cached = getCachedSession();
  if (isCachedSessionValid(30_000) && cached?.user?.id === cachedUserId) {
    if (!sessionReadyPromise) {
      sessionReadyPromise = restoreClientSession(cached).finally(() => {
        /* keep promise resolved so we do not re-hit Auth on every push */
      });
    }
    await sessionReadyPromise;
    return true;
  }
  if (isCachedSessionValid(30_000) && cached?.user?.id) {
    cachedUserId = cached.user.id;
    sessionReadyPromise = restoreClientSession(cached);
    await sessionReadyPromise;
    return true;
  }
  sessionReadyPromise = null;
  return false;
}

function scheduleSync(key, value) {
  if (!syncEnabled || !cachedUserId || !supabaseConfigured || !supabase) return;

  if (isPrefKey(key)) {
    if (!isSyncedPrefKey(key)) return;
    schedulePrefsSync();
    return;
  }

  const prev = pendingSync.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pendingSync.delete(key);
    const latest = readLocal(key);
    const payload = latest !== null && latest !== undefined ? latest : value;
    pushKeyToSupabase(key, payload).catch((err) => {
      console.warn('[sync] push failed:', key, err?.message || err, err);
      window.dispatchEvent(
        new CustomEvent('sync-failed', {
          detail: { key, message: err?.message || String(err) },
        })
      );
    });
  }, SYNC_DEBOUNCE_MS);
  pendingSync.set(key, { timer, value });
}

function scheduleDelete(key) {
  if (!syncEnabled || !cachedUserId || !supabaseConfigured || !supabase) return;

  if (key.startsWith('goals:')) {
    const taskDate = key.slice('goals:'.length);
    verifySessionForSync().then((ok) => {
      if (!ok) return;
      supabase
        .from('tasks')
        .delete()
        .eq('user_id', cachedUserId)
        .eq('task_date', taskDate)
        .then(({ error }) => {
          if (error) console.warn('[sync] delete task failed:', error.message || error);
        });
    });
    return;
  }

  if (key.startsWith('reflection:')) {
    const reflectionDate = key.slice('reflection:'.length);
    verifySessionForSync().then((ok) => {
      if (!ok) return;
      supabase
        .from('reflections')
        .delete()
        .eq('user_id', cachedUserId)
        .eq('reflection_date', reflectionDate)
        .then(({ error }) => {
          if (error) console.warn('[sync] delete reflection failed:', error.message || error);
        });
    });
  }
}

function schedulePrefsSync() {
  if (!syncEnabled || !cachedUserId || !supabase) return;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    prefsTimer = null;
    pushPrefsBlob().catch((err) => console.warn('[sync] prefs failed:', err?.message || err));
  }, PREFS_DEBOUNCE_MS);
}

async function pushKeyToSupabase(key, value) {
  if (!(await verifySessionForSync())) {
    console.warn('[sync] push skipped (no valid session):', key);
    return;
  }

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
    const snapshot = stableJson(
      habits.map((h) => ({
        id: h.id,
        text: h.text,
        history: trimHistoryObject(h.history || {}, HABIT_HISTORY_KEEP_DAYS),
        streak: h.streak,
        bestStreak: h.bestStreak,
        subtasks: h.subtasks,
        subtaskLog: trimHistoryObject(h.subtaskLog || {}, HABIT_HISTORY_KEEP_DAYS),
        emoji: h.emoji,
      }))
    );
    if (snapshot === lastPushedHabitsJson) return;

    const rows = habits.map(habitRowFromLocal);
    if (rows.length > 0) {
      const { error } = await supabase.from('habits').upsert(rows, { onConflict: 'user_id,id' });
      if (error) throw error;
    }

    const localIds = new Set(habits.map((h) => h.id).filter(Boolean));
    let cloudIds = knownHabitIds;
    if (cloudIds.size === 0) {
      const { data: idRows, error: idErr } = await supabase
        .from('habits')
        .select('id')
        .eq('user_id', cachedUserId);
      if (idErr) throw idErr;
      cloudIds = new Set((idRows || []).map((r) => r.id));
    }
    const orphanIds = [...cloudIds].filter((id) => !localIds.has(id));
    if (orphanIds.length > 0) {
      const { error: delErr } = await supabase
        .from('habits')
        .delete()
        .eq('user_id', cachedUserId)
        .in('id', orphanIds);
      if (delErr) throw delErr;
    } else if (habits.length === 0 && cloudIds.size > 0) {
      const { error: delErr } = await supabase.from('habits').delete().eq('user_id', cachedUserId);
      if (delErr) throw delErr;
    }

    knownHabitIds = localIds;
    lastPushedHabitsJson = snapshot;
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
    return;
  }

  if (key === 'learning_log_v1') {
    const entries = Array.isArray(readLocal('learning_log_v1'))
      ? readLocal('learning_log_v1')
      : Array.isArray(value)
        ? value
        : [];
    const snapshot = stableJson(entries);
    if (snapshot === lastPushedLearningJson) return;

    console.info('[sync] pushing learning entries:', entries.length);

    if (entries.length > 0) {
      const rows = entries.map((e) => ({
        id: e.id,
        user_id: cachedUserId,
        entry_date: e.date,
        title: e.title || '',
        source_url: e.sourceUrl || '',
        source_type: e.sourceType || 'other',
        notes: e.notes || '',
        tags: Array.isArray(e.tags) ? e.tags : [],
        updated_at: new Date(e.updatedAt || Date.now()).toISOString(),
      }));
      const { error } = await supabase.from('learning_entries').upsert(rows, { onConflict: 'user_id,id' });
      if (error) throw error;
    }

    const localIds = new Set(entries.map((e) => e.id).filter(Boolean));
    let cloudIds = knownLearningIds;
    if (cloudIds.size === 0) {
      const { data: idRows, error: idErr } = await supabase
        .from('learning_entries')
        .select('id')
        .eq('user_id', cachedUserId);
      if (idErr) throw idErr;
      cloudIds = new Set((idRows || []).map((r) => r.id));
    }
    const orphanIds = [...cloudIds].filter((id) => !localIds.has(id));

    if (orphanIds.length > 0) {
      const { error: delErr } = await supabase
        .from('learning_entries')
        .delete()
        .eq('user_id', cachedUserId)
        .in('id', orphanIds);
      if (delErr) throw delErr;
    } else if (entries.length === 0 && cloudIds.size > 0) {
      const { error: delErr } = await supabase
        .from('learning_entries')
        .delete()
        .eq('user_id', cachedUserId);
      if (delErr) throw delErr;
    }

    knownLearningIds = localIds;
    lastPushedLearningJson = snapshot;
    console.info('[sync] learning entries pushed OK');
    window.dispatchEvent(new CustomEvent('sync-ok', { detail: { key: 'learning_log_v1' } }));
    return;
  }
}

function collectPrefsBlob() {
  const data = {};
  for (const key of SYNCED_PREF_KEYS) {
    const v = readLocal(key);
    if (v !== null && v !== undefined) data[key] = v;
  }
  return data;
}

async function pushPrefsBlob() {
  if (!(await verifySessionForSync())) return;
  const data = collectPrefsBlob();
  const snapshot = stableJson(data);
  if (snapshot === lastPushedPrefsJson) return;

  const { error } = await supabase.from('user_preferences').upsert(
    {
      user_id: cachedUserId,
      data,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
  lastPushedPrefsJson = snapshot;
}

export async function pushAllLocalToSupabase() {
  if (!(await verifySessionForSync())) return;

  // Force full push on migrate (ignore change-detection snapshots).
  lastPushedHabitsJson = null;
  lastPushedLearningJson = null;
  lastPushedPrefsJson = null;

  const localHabits = readLocal('habits_v1') || [];
  knownHabitIds = new Set((Array.isArray(localHabits) ? localHabits : []).map((h) => h.id).filter(Boolean));
  const localLearn = readLocal('learning_log_v1') || [];
  knownLearningIds = new Set((Array.isArray(localLearn) ? localLearn : []).map((e) => e.id).filter(Boolean));

  const jobs = [];
  storeListKeys('goals:').forEach((key) => {
    jobs.push(pushKeyToSupabase(key, readLocal(key)));
  });
  jobs.push(pushKeyToSupabase('habits_v1', localHabits));
  jobs.push(pushKeyToSupabase('learning_log_v1', localLearn));
  storeListKeys('reflection:').forEach((key) => {
    jobs.push(pushKeyToSupabase(key, readLocal(key)));
  });
  jobs.push(pushPrefsBlob());
  const results = await Promise.allSettled(jobs);
  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      console.warn('[sync] bulk push item failed:', idx, result.reason?.message || result.reason);
    }
  });
}

/** Upload existing localStorage only when the user has no cloud rows yet (first device). */
export async function migrateLocalIfCloudEmpty(userId) {
  if (!userId || !supabase) return;
  const { count, error } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) {
    console.warn('[sync] cloud check failed:', error.message || error);
    return;
  }
  if ((count ?? 0) > 0) return;
  cachedUserId = userId;
  await pushAllLocalToSupabase();
}

function mergeLearningEntries(localEntries, cloudRows) {
  const toEntry = (row) => ({
    id: row.id,
    date: row.entry_date ?? row.date,
    title: row.title || '',
    sourceUrl: row.source_url ?? row.sourceUrl ?? '',
    sourceType: row.source_type ?? row.sourceType ?? 'other',
    notes: row.notes || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    updatedAt: row.updated_at
      ? new Date(row.updated_at).getTime()
      : row.updatedAt || Date.now(),
    createdAt: row.created_at
      ? new Date(row.created_at).getTime()
      : row.createdAt || row.updatedAt || Date.now(),
  });

  const byId = new Map();
  (Array.isArray(localEntries) ? localEntries : []).forEach((entry) => {
    if (entry?.id) byId.set(entry.id, entry);
  });
  (Array.isArray(cloudRows) ? cloudRows : []).forEach((row) => {
    const cloudEntry = toEntry(row);
    const local = byId.get(cloudEntry.id);
    if (!local || (cloudEntry.updatedAt || 0) >= (local.updatedAt || 0)) {
      byId.set(cloudEntry.id, cloudEntry);
    }
  });

  return [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function hydrateFromSupabase(userId) {
  if (!userId || !supabaseConfigured || !supabase) return;

  await restoreClientSession(getCachedSession());
  sessionReadyPromise = Promise.resolve();

  const fromDate = isoDateOffset(-HYDRATE_PAST_DAYS);
  const toDate = isoDateOffset(HYDRATE_FUTURE_DAYS);

  const [tasksRes, habitsRes, reflRes, learnRes, prefsRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('task_date, goals, updated_at')
      .eq('user_id', userId)
      .gte('task_date', fromDate)
      .lte('task_date', toDate),
    supabase
      .from('habits')
      .select('id, text, history, streak, best_streak, subtasks, subtask_log, emoji, updated_at')
      .eq('user_id', userId),
    supabase
      .from('reflections')
      .select('reflection_date, wins, struggles, tomorrow, summary, updated_at')
      .eq('user_id', userId)
      .gte('reflection_date', fromDate)
      .lte('reflection_date', toDate),
    supabase
      .from('learning_entries')
      .select('id, entry_date, title, source_url, source_type, notes, tags, updated_at')
      .eq('user_id', userId)
      .gte('entry_date', fromDate),
    supabase.from('user_preferences').select('data').eq('user_id', userId).maybeSingle(),
  ]);

  if (tasksRes.error) throw tasksRes.error;
  if (habitsRes.error) throw habitsRes.error;
  if (reflRes.error) throw reflRes.error;
  if (prefsRes.error) throw prefsRes.error;

  if (learnRes.error) {
    console.warn('[sync] learning_entries fetch failed (keeping local data):', learnRes.error.message || learnRes.error);
  }

  (tasksRes.data || []).forEach((row) => {
    writeLocal(`goals:${row.task_date}`, row.goals || []);
  });

  if (habitsRes.data?.length) {
    const localHabits = readLocal('habits_v1') || [];
    const localById = Object.fromEntries(localHabits.map((h) => [h.id, h]));

    const habits = habitsRes.data.map((h) => {
      const local = localById[h.id];
      const cloudSubtasks = Array.isArray(h.subtasks) ? h.subtasks : [];
      const subtasks = cloudSubtasks.length ? cloudSubtasks : local?.subtasks || [];
      const cloudLog = h.subtask_log && typeof h.subtask_log === 'object' ? h.subtask_log : {};
      const subtaskLog =
        Object.keys(cloudLog).length > 0 ? cloudLog : local?.subtaskLog || {};
      return {
        id: h.id,
        text: h.text,
        history: trimHistoryObject(h.history || {}, HABIT_HISTORY_KEEP_DAYS),
        streak: h.streak ?? 0,
        bestStreak: h.best_streak ?? 0,
        subtasks,
        subtaskLog: trimHistoryObject(subtaskLog, HABIT_HISTORY_KEEP_DAYS),
        emoji: h.emoji ?? local?.emoji,
      };
    });
    writeLocal('habits_v1', habits);
    knownHabitIds = new Set(habits.map((h) => h.id).filter(Boolean));
    lastPushedHabitsJson = stableJson(
      habits.map((h) => ({
        id: h.id,
        text: h.text,
        history: h.history,
        streak: h.streak,
        bestStreak: h.bestStreak,
        subtasks: h.subtasks,
        subtaskLog: h.subtaskLog,
        emoji: h.emoji,
      }))
    );
  } else {
    knownHabitIds = new Set();
    lastPushedHabitsJson = stableJson([]);
  }

  const localLearning = readLocal('learning_log_v1') || [];
  if (!learnRes.error) {
    const mergedLearning = mergeLearningEntries(localLearning, learnRes.data || []);
    writeLocal('learning_log_v1', mergedLearning);
    knownLearningIds = new Set(mergedLearning.map((e) => e.id).filter(Boolean));
    lastPushedLearningJson = stableJson(mergedLearning);
    console.info('[sync] learning entries hydrated:', mergedLearning.length);
  } else if (localLearning.length > 0) {
    knownLearningIds = new Set(localLearning.map((e) => e.id).filter(Boolean));
    console.info('[sync] keeping local learning entries:', localLearning.length);
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
    Object.entries(prefs).forEach(([k, v]) => {
      // Never overwrite local-only keys from a legacy mega-blob (e.g. base64 photos).
      if (isSyncedPrefKey(k)) writeLocal(k, v);
    });
    lastPushedPrefsJson = stableJson(collectPrefsBlob());
  }

  window.dispatchEvent(new CustomEvent('data-hydrated'));
}
