-- Crupids Dashboard — run in Supabase SQL Editor
-- Requires: Auth enabled; RLS on by default for new tables

-- ── Tasks (one row per calendar day, goals stored as JSON array) ──
create table if not exists public.tasks (
  user_id uuid not null references auth.users (id) on delete cascade,
  task_date date not null,
  goals jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, task_date)
);

alter table public.tasks enable row level security;

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
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.habits enable row level security;

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

-- ── Optional: settings, streaks, stats, day state, profile pic (multi-device parity) ──
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

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

-- Helpful indexes
create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at desc);
create index if not exists habits_user_updated_idx on public.habits (user_id, updated_at desc);
create index if not exists reflections_user_updated_idx on public.reflections (user_id, updated_at desc);
