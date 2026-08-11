-- ============================================================================
-- Recovery Journal — database schema
--
-- Run this once in your Supabase project's SQL Editor:
--   Dashboard -> SQL Editor -> New query -> paste this whole file -> Run
-- ============================================================================

-- One table, one row per (user, date). "unique (user_id, entry_date)" at the
-- bottom is what makes the app's "upsert" (update-if-exists-else-insert)
-- logic work: Supabase uses that constraint to know which existing row to
-- update when you save a second entry for the same day.
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,

  -- Sleep & nutrition
  sleep_hours integer,
  sleep_quality integer,
  steps integer,
  food_quality text,

  -- Knee
  knee_swollen text,
  knee_status text,
  knee_issues text,
  rehab_done boolean,
  exercises_done text,
  exercise_note text,
  progress_last_week text,

  -- Other pain
  hamstring_pain numeric,
  wrist_pain numeric,
  other_pain text,

  -- Overall wellbeing
  work_hours numeric,
  school_hours numeric,
  overall_physical_status numeric,
  overall_stress numeric,
  mood_during_day numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, entry_date)
);

-- Keep "updated_at" current automatically whenever a row changes.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.journal_entries;
create trigger set_updated_at
  before update on public.journal_entries
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security (RLS): with RLS on, Postgres checks a rule on every
-- single read/write, on top of the normal permission system. The rule below
-- says "you may only ever see or change rows where user_id is you" — so even
-- though the browser talks to Supabase using a public API key, one signed-in
-- user can never read or overwrite another's rows.
-- ----------------------------------------------------------------------------
alter table public.journal_entries enable row level security;

create policy "Select own entries"
  on public.journal_entries for select
  using (auth.uid() = user_id);

create policy "Insert own entries"
  on public.journal_entries for insert
  with check (auth.uid() = user_id);

create policy "Update own entries"
  on public.journal_entries for update
  using (auth.uid() = user_id);

create policy "Delete own entries"
  on public.journal_entries for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Migration: if you already ran this file once and created the table before
-- these three columns existed, run just this block instead (it's harmless to
-- run even on a brand-new table, since "if not exists" skips columns that
-- are already there).
-- ----------------------------------------------------------------------------
alter table public.journal_entries add column if not exists overall_physical_status numeric;
alter table public.journal_entries add column if not exists overall_stress numeric;
alter table public.journal_entries add column if not exists mood_during_day numeric;

-- ----------------------------------------------------------------------------
-- Table grants: separate from Row Level Security. Postgres checks these
-- first — without them, even a logged-in ("authenticated") user gets
-- "permission denied for table", regardless of what the RLS policies above
-- say. RLS then narrows it down further to "only your own rows".
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.journal_entries to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Migration: workout tracking moved to its own set of tables (see
-- supabase-schema-workouts.sql), so these two columns are no longer used by
-- the journal. If you already created the table before this change, run
-- just this block to drop them and match the current app.
-- ----------------------------------------------------------------------------
alter table public.journal_entries drop column if exists workout;
alter table public.journal_entries drop column if exists workout_strain;
