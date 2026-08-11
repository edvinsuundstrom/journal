-- ============================================================================
-- Recovery Journal — Workouts schema
--
-- Run this once in your Supabase project's SQL Editor, the same way you ran
-- supabase-schema.sql:
--   Dashboard -> SQL Editor -> New query -> paste this whole file -> Run
--
-- Four tables:
--   exercises          your reusable exercise library (created once, picked
--                      from a dropdown every time after that)
--   workout_sessions   one row per date you log a workout; "category" is
--                      optional and belongs to the whole session, not to any
--                      one exercise
--   session_exercises  which exercises were done in a given session, and how
--                      each is tracked (reps / weight+reps / time / weight+time)
--   exercise_sets      each individual set as its own row — this is what
--                      makes "remove a set" a real delete instead of just
--                      blanking a value, so no half-empty rows pile up
-- ============================================================================

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, exercise_name)
);

create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_date date not null,
  category text, -- optional, filled in whenever — belongs to the session
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, session_date)
);

create table if not exists public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  tracking_type text not null, -- 'reps' | 'weight_reps' | 'time' | 'weight_time'
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.exercise_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  -- exercise_id is duplicated here (also reachable via session_exercise_id)
  -- on purpose: it makes "best 1RM ever for this exercise" a simple direct
  -- query instead of a three-table join every time you save a set.
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  set_number integer not null,
  weight numeric,
  reps integer,
  time_seconds numeric,
  one_rep_max numeric, -- Epley formula: weight × (1 + reps/30), calculated in the app
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep "updated_at" current automatically (reuses the function created by
-- supabase-schema.sql; safe to redefine here too in case this file is ever
-- run on its own).
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.workout_sessions;
create trigger set_updated_at
  before update on public.workout_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.exercise_sets;
create trigger set_updated_at
  before update on public.exercise_sets
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security: same rule as the journal — you can only ever see or
-- change rows that belong to you.
-- ----------------------------------------------------------------------------
alter table public.exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.exercise_sets enable row level security;

create policy "Select own exercises" on public.exercises for select using (auth.uid() = user_id);
create policy "Insert own exercises" on public.exercises for insert with check (auth.uid() = user_id);
create policy "Update own exercises" on public.exercises for update using (auth.uid() = user_id);
create policy "Delete own exercises" on public.exercises for delete using (auth.uid() = user_id);

create policy "Select own sessions" on public.workout_sessions for select using (auth.uid() = user_id);
create policy "Insert own sessions" on public.workout_sessions for insert with check (auth.uid() = user_id);
create policy "Update own sessions" on public.workout_sessions for update using (auth.uid() = user_id);
create policy "Delete own sessions" on public.workout_sessions for delete using (auth.uid() = user_id);

create policy "Select own session exercises" on public.session_exercises for select using (auth.uid() = user_id);
create policy "Insert own session exercises" on public.session_exercises for insert with check (auth.uid() = user_id);
create policy "Update own session exercises" on public.session_exercises for update using (auth.uid() = user_id);
create policy "Delete own session exercises" on public.session_exercises for delete using (auth.uid() = user_id);

create policy "Select own sets" on public.exercise_sets for select using (auth.uid() = user_id);
create policy "Insert own sets" on public.exercise_sets for insert with check (auth.uid() = user_id);
create policy "Update own sets" on public.exercise_sets for update using (auth.uid() = user_id);
create policy "Delete own sets" on public.exercise_sets for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Table grants: separate from RLS. Without these, saving a workout will fail
-- with "permission denied for table" even though the RLS policies above are
-- correct — same issue we hit with journal_entries earlier.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.exercises to anon, authenticated;
grant select, insert, update, delete on public.workout_sessions to anon, authenticated;
grant select, insert, update, delete on public.session_exercises to anon, authenticated;
grant select, insert, update, delete on public.exercise_sets to anon, authenticated;
