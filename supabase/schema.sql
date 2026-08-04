-- État partagé de l’application.
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

-- Stockage privé des photos d’emplacements d’entreposage.
-- Les fonctions Vercel y accèdent avec SUPABASE_SECRET_KEY.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'stock-location-photos',
  'stock-location-photos',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
