-- Version 5 - état partagé, comptes, approbations et photos privées.

create table if not exists public.app_state (
  id text primary key,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
revoke all on table public.app_state from anon, authenticated;
insert into public.app_state (id, snapshot) values ('default', '{}'::jsonb) on conflict (id) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  role text not null default 'employee',
  approval_status text not null default 'pending',
  has_lift_permit boolean not null default false,
  lift_permit_number text not null default '',
  lift_permit_expires_at date,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('employee', 'supervisor', 'admin')),
  constraint profiles_approval_check check (approval_status in ('pending', 'approved', 'rejected'))
);
alter table public.profiles add column if not exists email text not null default '';
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists role text not null default 'employee';
alter table public.profiles add column if not exists approval_status text not null default 'pending';
alter table public.profiles add column if not exists has_lift_permit boolean not null default false;
alter table public.profiles add column if not exists lift_permit_number text not null default '';
alter table public.profiles add column if not exists lift_permit_expires_at date;
alter table public.profiles add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, approval_status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'Utilisateur'), '@', 1)),
    'employee',
    'pending'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = case when public.profiles.full_name = '' then excluded.full_name else public.profiles.full_name end,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute procedure public.handle_new_user();

-- Crée les profils manquants pour les utilisateurs déjà inscrits.
insert into public.profiles (id, email, full_name, role, approval_status)
select u.id, coalesce(u.email, ''), coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(u.email, 'Utilisateur'), '@', 1)), 'employee', 'pending'
from auth.users u
on conflict (id) do nothing;

-- Photos privées d'emplacements d'entreposage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stock-location-photos', 'stock-location-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
