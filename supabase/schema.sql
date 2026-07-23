-- Altitude cloud sync schema.
-- Run this once in Supabase → SQL Editor (paste and Run).
-- Model: one row per user holding the whole app state as JSON. Simple and
-- robust for a single-user personal tool; last write wins on conflicts.

create table if not exists public.app_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  writer_id  text,
  updated_at timestamptz not null default now()
);

-- Row Level Security: a user can only see and change their own row.
alter table public.app_state enable row level security;

drop policy if exists "own row - select" on public.app_state;
create policy "own row - select" on public.app_state
  for select using (auth.uid() = user_id);

drop policy if exists "own row - insert" on public.app_state;
create policy "own row - insert" on public.app_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own row - update" on public.app_state;
create policy "own row - update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Enable realtime so edits on one device stream to the others.
alter publication supabase_realtime add table public.app_state;
