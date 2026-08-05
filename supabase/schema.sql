-- =============================================================================
-- Crupids Dashboard — full schema for a NEW Supabase project
-- =============================================================================
-- How to use:
--   1. Open your project → SQL Editor → New query
--   2. Paste this entire file and Run
--   3. Authentication → Users → create your account (or sign up from the app)
--   4. Put Project URL + anon key in crupids-dashboard/.env
--
-- Safe to re-run: tables use IF NOT EXISTS; policies are dropped then recreated.
-- =============================================================================

-- ── Tasks (one row per calendar day, goals stored as JSON array) ──
create table if not exists public.tasks (
  user_id uuid not null references auth.users (id) on delete cascade,
  task_date date not null,
  goals jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, task_date)
);

alter table public.tasks enable row level security;

drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;

create policy "tasks_select_own"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "tasks_insert_own"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "tasks_update_own"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tasks_delete_own"
  on public.tasks for delete
  using (auth.uid() = user_id);

-- ── Habits (one row per habit) ──
create table if not exists public.habits (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  text text not null default '',
  history jsonb not null default '{}'::jsonb,
  streak integer not null default 0,
  best_streak integer not null default 0,
  subtasks jsonb not null default '[]'::jsonb,
  subtask_log jsonb not null default '{}'::jsonb,
  emoji text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.habits enable row level security;

drop policy if exists "habits_select_own" on public.habits;
drop policy if exists "habits_insert_own" on public.habits;
drop policy if exists "habits_update_own" on public.habits;
drop policy if exists "habits_delete_own" on public.habits;

create policy "habits_select_own"
  on public.habits for select
  using (auth.uid() = user_id);

create policy "habits_insert_own"
  on public.habits for insert
  with check (auth.uid() = user_id);

create policy "habits_update_own"
  on public.habits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "habits_delete_own"
  on public.habits for delete
  using (auth.uid() = user_id);

-- ── Reflections (one row per day) ──
create table if not exists public.reflections (
  user_id uuid not null references auth.users (id) on delete cascade,
  reflection_date date not null,
  wins text not null default '',
  struggles text not null default '',
  tomorrow text not null default '',
  summary text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, reflection_date)
);

alter table public.reflections enable row level security;

drop policy if exists "reflections_select_own" on public.reflections;
drop policy if exists "reflections_insert_own" on public.reflections;
drop policy if exists "reflections_update_own" on public.reflections;
drop policy if exists "reflections_delete_own" on public.reflections;

create policy "reflections_select_own"
  on public.reflections for select
  using (auth.uid() = user_id);

create policy "reflections_insert_own"
  on public.reflections for insert
  with check (auth.uid() = user_id);

create policy "reflections_update_own"
  on public.reflections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reflections_delete_own"
  on public.reflections for delete
  using (auth.uid() = user_id);

-- ── Learning log (one row per entry) ──
create table if not exists public.learning_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  entry_date date not null,
  title text not null default '',
  source_url text not null default '',
  source_type text not null default 'other',
  notes text not null default '',
  tags jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.learning_entries enable row level security;

drop policy if exists "learning_entries_select_own" on public.learning_entries;
drop policy if exists "learning_entries_insert_own" on public.learning_entries;
drop policy if exists "learning_entries_update_own" on public.learning_entries;
drop policy if exists "learning_entries_delete_own" on public.learning_entries;

create policy "learning_entries_select_own"
  on public.learning_entries for select
  using (auth.uid() = user_id);

create policy "learning_entries_insert_own"
  on public.learning_entries for insert
  with check (auth.uid() = user_id);

create policy "learning_entries_update_own"
  on public.learning_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "learning_entries_delete_own"
  on public.learning_entries for delete
  using (auth.uid() = user_id);

-- ── Small settings blob (title, streaks, stats — NOT profile photos) ──
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
drop policy if exists "user_preferences_insert_own" on public.user_preferences;
drop policy if exists "user_preferences_update_own" on public.user_preferences;
drop policy if exists "user_preferences_delete_own" on public.user_preferences;

create policy "user_preferences_select_own"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "user_preferences_insert_own"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "user_preferences_update_own"
  on public.user_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_preferences_delete_own"
  on public.user_preferences for delete
  using (auth.uid() = user_id);

-- Indexes (hydrate filters by date; sync filters by user)
create index if not exists tasks_user_date_idx on public.tasks (user_id, task_date);
create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at desc);
create index if not exists habits_user_updated_idx on public.habits (user_id, updated_at desc);
create index if not exists reflections_user_date_idx on public.reflections (user_id, reflection_date);
create index if not exists reflections_user_updated_idx on public.reflections (user_id, updated_at desc);
create index if not exists learning_entries_user_date_idx on public.learning_entries (user_id, entry_date desc);

-- Columns for older projects that already had habits without subtasks/emoji
alter table public.habits add column if not exists subtasks jsonb not null default '[]'::jsonb;
alter table public.habits add column if not exists subtask_log jsonb not null default '{}'::jsonb;
alter table public.habits add column if not exists emoji text;
