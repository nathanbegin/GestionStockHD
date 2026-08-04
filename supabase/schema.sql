create table if not exists public.app_state (
  id text primary key,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;
revoke all on table public.app_state from anon, authenticated;

insert into public.app_state (id, snapshot)
values ('default', '{}'::jsonb)
on conflict (id) do nothing;
