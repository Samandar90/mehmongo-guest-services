create extension if not exists pgcrypto;
create schema if not exists private;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and role = 'super_admin'
      and active
  );
$$;

create or replace function private.next_request_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  random_bytes bytea := extensions.gen_random_bytes(5);
  encoded text := '';
  accumulator bigint := 0;
begin
  for byte_index in 0..4 loop
    accumulator := (accumulator << 8) | get_byte(random_bytes, byte_index);
  end loop;

  for character_index in reverse 7..0 loop
    encoded := encoded || substr(
      alphabet,
      (((accumulator >> (character_index * 5)) & 31::bigint)::integer + 1),
      1
    );
  end loop;

  return 'MG-' || encoded;
end;
$$;

create table public.hotels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 120),
  address text not null default '',
  commission_bps integer not null default 0 check (commission_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels(id) on delete restrict,
  label text not null check (char_length(label) between 1 and 40),
  public_token uuid not null unique default gen_random_uuid(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, label),
  unique (id, hotel_id)
);

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default private.next_request_reference()
    check (reference ~ '^MG-[A-Z2-7]{8}$'),
  idempotency_key uuid not null unique,
  rate_limit_key text not null,
  hotel_id uuid not null references public.hotels(id) on delete restrict,
  room_id uuid not null,
  service_type text not null check (service_type in ('tours', 'transport', 'restaurants', 'tickets')),
  choice text,
  pickup text,
  destination text,
  requested_date date,
  requested_time time,
  party_size integer,
  guest_name text not null,
  guest_contact text not null,
  note text not null default '',
  status text not null default 'new' check (status in ('new')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (room_id, hotel_id) references public.rooms(id, hotel_id) on delete restrict
);

create table public.telegram_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  telegram_message_id bigint,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (request_id, attempt)
);

create index rooms_hotel_active_idx on public.rooms (hotel_id, active);
create index service_requests_hotel_created_idx on public.service_requests (hotel_id, created_at desc);
create index service_requests_service_created_idx on public.service_requests (service_type, created_at desc);
create index service_requests_status_created_idx on public.service_requests (status, created_at desc);
create index service_requests_room_created_idx on public.service_requests (room_id, created_at desc);
create index service_requests_rate_limit_idx on public.service_requests (rate_limit_key, created_at desc);
create index telegram_deliveries_status_created_idx on public.telegram_deliveries (status, created_at);

alter table public.admin_users enable row level security;
alter table public.hotels enable row level security;
alter table public.rooms enable row level security;
alter table public.service_requests enable row level security;
alter table public.telegram_deliveries enable row level security;

revoke all on table public.admin_users from public, anon, authenticated;
revoke all on table public.hotels from public, anon, authenticated;
revoke all on table public.rooms from public, anon, authenticated;
revoke all on table public.service_requests from public, anon, authenticated;
revoke all on table public.telegram_deliveries from public, anon, authenticated;

grant select on table public.admin_users to authenticated;
grant select, insert, update on table public.hotels to authenticated;
grant select, insert, update on table public.rooms to authenticated;
grant select on table public.service_requests to authenticated;
grant select on table public.telegram_deliveries to authenticated;

grant all on table public.admin_users to service_role;
grant all on table public.hotels to service_role;
grant all on table public.rooms to service_role;
grant all on table public.service_requests to service_role;
grant all on table public.telegram_deliveries to service_role;

revoke all on function private.is_super_admin() from public;
revoke all on function private.next_request_reference() from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_super_admin() to authenticated, service_role;
grant execute on function private.next_request_reference() to service_role;

create policy "super admins read admin users"
on public.admin_users
for select
to authenticated
using (private.is_super_admin());

create policy "super admins manage hotels"
on public.hotels
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

create policy "super admins manage rooms"
on public.rooms
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

create policy "super admins read requests"
on public.service_requests
for select
to authenticated
using (private.is_super_admin());

create policy "super admins read telegram deliveries"
on public.telegram_deliveries
for select
to authenticated
using (private.is_super_admin());
