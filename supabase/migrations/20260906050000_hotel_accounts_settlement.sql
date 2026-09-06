-- Hotel accounts and request settlement.
--
-- The owner records what a request settled for; a hotel only reads its own
-- numbers. Money is stored as integer minor units with an explicit currency,
-- because the published price is USD while the amount actually payable is
-- agreed in UZS. Purchase prices and the bonus formula stay out of the
-- database entirely.

-- One account belongs to one hotel; the owner belongs to none.
alter table public.admin_users
  add column hotel_id uuid references public.hotels(id) on delete restrict;

alter table public.admin_users
  drop constraint admin_users_role_check,
  add constraint admin_users_role_check check (role in ('super_admin', 'hotel')),
  add constraint admin_users_scope_check check (
    (role = 'super_admin' and hotel_id is null)
    or (role = 'hotel' and hotel_id is not null)
  );

comment on column public.admin_users.hotel_id is
  'The hotel a hotel account may read. Null for the owner, who reads everything.';

create index admin_users_hotel_idx on public.admin_users (hotel_id) where hotel_id is not null;

-- What became of a request, and what it was worth.
alter table public.service_requests
  drop constraint service_requests_status_check,
  add constraint service_requests_status_check
    check (status in ('new', 'confirmed', 'completed', 'cancelled')),
  add column settled_amount_minor bigint check (settled_amount_minor >= 0),
  add column settled_currency text check (settled_currency ~ '^[A-Z]{3}$'),
  add column hotel_commission_bps integer check (hotel_commission_bps between 0 and 10000);

-- bigint, not integer: one bill is settled in som, and a 32-bit column runs out
-- just past 21 million som once minor units are applied. Tickets for a family
-- pass that, so the narrower type would have failed on a real transaction.
comment on column public.service_requests.settled_amount_minor is
  'What the request settled for, in minor units of settled_currency. Integer only: no floating point touches the money path.';

-- Money exists on a completed request and nowhere else, so a total can never
-- quietly include something that was cancelled or never agreed.
alter table public.service_requests
  add constraint service_requests_settlement_check check (
    (status = 'completed'
      and settled_amount_minor is not null
      and settled_currency is not null
      and hotel_commission_bps is not null)
    or (status <> 'completed'
      and settled_amount_minor is null
      and settled_currency is null
      and hotel_commission_bps is null)
  );

comment on column public.service_requests.hotel_commission_bps is
  'The hotel commission frozen at settlement. Renegotiating a rate must not rewrite what was already earned.';

-- Derived, so the owner's number and the hotel's number are the same number by
-- construction. round() on numeric goes to the nearest minor unit.
alter table public.service_requests
  add column hotel_payout_minor bigint
    generated always as (
      round(settled_amount_minor::numeric * hotel_commission_bps / 10000)::bigint
    ) stored;

create index service_requests_settlement_idx
  on public.service_requests (hotel_id, status, created_at desc)
  where status = 'completed';

-- The hotel an active hotel account may read, or null for anyone else.
create or replace function private.admin_hotel_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account.hotel_id
  from public.admin_users as account
  where account.user_id = (select auth.uid())
    and account.role = 'hotel'
    and account.active;
$$;

revoke all on function private.admin_hotel_id() from public;
grant execute on function private.admin_hotel_id() to authenticated, service_role;

-- An account reads its own row, which is how the client learns its role. The
-- owner keeps the existing policy over every row.
create policy "accounts read their own row"
on public.admin_users
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "hotels read their own hotel"
on public.hotels
for select
to authenticated
using (id = private.admin_hotel_id());

create policy "hotels read their own rooms"
on public.rooms
for select
to authenticated
using (hotel_id = private.admin_hotel_id());

create policy "hotels read their own requests"
on public.service_requests
for select
to authenticated
using (hotel_id = private.admin_hotel_id());

-- No write grant is added: settlement goes through an owner-checked routine, so
-- a hotel attempting to edit its own figures is refused outright rather than
-- silently updating nothing.
