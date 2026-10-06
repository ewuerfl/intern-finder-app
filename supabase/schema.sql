-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Each person's tracked applications. Row Level Security makes sure people can only see and change their own rows.
create table if not exists public.applications (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.applications enable row level security;
drop policy if exists "Own applications" on public.applications;
create policy "Own applications" on public.applications
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
