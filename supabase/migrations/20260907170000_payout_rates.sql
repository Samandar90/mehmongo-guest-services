-- Fixed per-request payouts, replacing the percentage of turnover.
--
-- The hotel is paid an agreed sum for each completed request, not a share of
-- what the request sold for. Two things follow, and both are the point rather
-- than a side effect:
--
--   1. The hotel can check its own payout by counting. It never has to trust,
--      or even see, what we sold the service for.
--   2. The payout stops being a function of the settled amount, so the amount
--      can be hidden from the hotel without hiding the payout.
--
-- This migration only ADDS. The percentage columns, settle_request and
-- settlement_summary are left exactly as they are, so every screen that reads
-- them keeps working while the application is moved over. The removal lives in
-- a later migration, after the code no longer reads them.

-- The rate card. A row per service category, so changing what a transfer pays
-- is an update, not a migration.
create table public.payout_rates (
  service_type text primary key
    check (service_type in ('tours', 'transport', 'restaurants', 'tickets')),
  rate_minor bigint not null check (rate_minor >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- Whether the monthly volume bonus multiplies this rate. Tickets earn us a
  -- service fee of roughly two and a half dollars, so a forty percent bonus on
  -- a two dollar rate would pay the hotel more than the ticket makes.
  tier_bonus_applies boolean not null,
  -- Whether the request counts toward the monthly volume that sets the tier.
  -- Kept separate from the bonus on purpose: a ticket pays a flat rate but
  -- still helps the hotel reach the next tier, which is what the partner page
  -- promises in plain words.
  counts_toward_tier boolean not null,
  updated_at timestamptz not null default now()
);

comment on table public.payout_rates is
  'What one completed request pays the hotel, by service category. Editable without a migration; every rate is frozen onto the request at settlement, so an edit never rewrites what was already earned.';

insert into public.payout_rates (service_type, rate_minor, currency, tier_bonus_applies, counts_toward_tier) values
  ('transport',   200, 'USD', true,  true),
  ('tours',       800, 'USD', true,  true),
  ('tickets',     200, 'USD', false, true),
  -- Restaurants take no commission from us, so there is nothing to share. The
  -- booking still counts toward the tier: the guest asked through the hotel's
  -- plaque, and the partner page promises that requests count.
  ('restaurants',   0, 'USD', false, true);

-- The volume ladder. min_requests is unique but not the key: the owner may
-- move a threshold, and a movable primary key would drag foreign references
-- and audit trails with it.
create table public.payout_tiers (
  id smallint primary key generated always as identity,
  min_requests integer not null unique check (min_requests >= 0),
  bonus_bps integer not null check (bonus_bps between 0 and 10000),
  label text not null,
  updated_at timestamptz not null default now()
);

comment on table public.payout_tiers is
  'Monthly volume ladder. The bonus applies to every request of that calendar month, not only those past the threshold, which is what the partner page states.';

insert into public.payout_tiers (min_requests, bonus_bps, label) values
  (0,     0, 'Старт'),
  (15, 2000, 'Партнёр'),
  (40, 4000, 'Премиум');

-- A ladder with no zero step would leave a hotel's first request unpriced.
alter table public.payout_tiers
  add constraint payout_tiers_has_ground_step
    check (min_requests > 0 or bonus_bps = 0);

-- Both tables describe the offer that is published on the partner site, so
-- reading them is not a disclosure. Writing them is the owner's alone.
alter table public.payout_rates enable row level security;
alter table public.payout_tiers enable row level security;

revoke all on table public.payout_rates from public, anon, authenticated;
revoke all on table public.payout_tiers from public, anon, authenticated;
grant select on table public.payout_rates to authenticated;
grant select on table public.payout_tiers to authenticated;
grant all on table public.payout_rates to service_role;
grant all on table public.payout_tiers to service_role;

create policy "signed in accounts read the rate card"
on public.payout_rates
for select
to authenticated
using (true);

create policy "super admins change the rate card"
on public.payout_rates
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

create policy "signed in accounts read the tiers"
on public.payout_tiers
for select
to authenticated
using (true);

create policy "super admins change the tiers"
on public.payout_tiers
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

create trigger payout_rates_set_updated_at
  before update on public.payout_rates
  for each row execute function private.set_updated_at();

create trigger payout_tiers_set_updated_at
  before update on public.payout_tiers
  for each row execute function private.set_updated_at();

-- When the work was actually done.
--
-- created_at is when the guest asked, which is not the same month often enough
-- to matter: a request made on 30 September and completed on 2 October belongs
-- to October's volume. Counting by created_at would also let a completion
-- recorded in November change September's tier — a month already paid.
alter table public.service_requests
  add column settled_at timestamptz;

comment on column public.service_requests.settled_at is
  'When the request first became completed. Set once and never moved, so a cancellation and a later re-completion cannot shift a request between paid months.';

-- The rate frozen onto the request, in minor units of its own currency.
--
-- Only the BASE rate is frozen. The tier bonus cannot be: it is a property of
-- the whole calendar month and is not known until the month ends. The bonus is
-- applied when the month is read, and fixed for good when the month is closed.
alter table public.service_requests
  add column hotel_rate_minor bigint check (hotel_rate_minor >= 0),
  add column hotel_rate_currency text check (hotel_rate_currency ~ '^[A-Z]{3}$'),
  add column hotel_rate_bonus_applies boolean,
  add column hotel_rate_counts_tier boolean;

comment on column public.service_requests.hotel_rate_minor is
  'The base payout rate frozen at settlement. Renegotiating the rate card must never rewrite what a past request already earned.';

-- Counting a month means scanning completed requests by settled_at.
create index service_requests_settled_at_idx
  on public.service_requests (hotel_id, settled_at)
  where status = 'completed';

-- Deliberately NOT added yet: a check tying settled_at and hotel_rate_minor to
-- the completed status. The existing service_requests_settlement_check still
-- demands the percentage columns, and settle_request still fills only those.
-- Adding the mirror check now would make every settlement fail until the new
-- settle_request ships. It arrives with that function, in the next migration.
