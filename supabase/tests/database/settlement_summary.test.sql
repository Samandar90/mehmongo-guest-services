begin;
select plan(21);

-- public.settlement_summary aggregates in the database, so a hotel with more
-- requests than one page still gets a true total.
--
-- It is security definer, not invoker. The hotel has no policy on
-- service_requests any more — a row policy cannot hide a column — so the
-- scoping lives here, next to the column list it has to enforce: a hotel sees
-- its own hotel and no turnover, the owner sees everything.

select has_function('public'::name, 'settlement_summary'::name, 'settlement_summary exists');

select function_privs_are(
  'public'::name, 'settlement_summary'::name,
  array['timestamptz', 'timestamptz']::name[],
  'anon'::name, array[]::text[],
  'anon cannot execute it'
);
select function_privs_are(
  'public'::name, 'settlement_summary'::name,
  array['timestamptz', 'timestamptz']::name[],
  'service_role'::name, array[]::text[],
  'the key that bypasses RLS cannot execute it either'
);
select function_privs_are(
  'public'::name, 'settlement_summary'::name,
  array['timestamptz', 'timestamptz']::name[],
  'authenticated'::name, array['EXECUTE']::text[],
  'authenticated may call it, and is scoped inside'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('83000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sum-owner@example.test', '', now(), now(), now()),
  ('83000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sum-hotel@example.test', '', now(), now(), now());

insert into public.hotels (id, slug, name, commission_bps)
values
  ('83000000-0000-4000-8000-000000000101', 'sum-first', 'Summary First', 1500),
  ('83000000-0000-4000-8000-000000000102', 'sum-second', 'Summary Second', 1000);

insert into public.rooms (id, hotel_id, label)
values
  ('83000000-0000-4000-8000-000000000201', '83000000-0000-4000-8000-000000000101', '501'),
  ('83000000-0000-4000-8000-000000000202', '83000000-0000-4000-8000-000000000102', '502');

insert into public.admin_users (user_id, role, active, hotel_id)
values
  ('83000000-0000-4000-8000-000000000001', 'super_admin', true, null),
  ('83000000-0000-4000-8000-000000000002', 'hotel', true, '83000000-0000-4000-8000-000000000101');

-- Settled rows are written directly rather than through settle_request, so the
-- completion moment can be placed on both sides of a month boundary.
insert into public.service_requests
  (id, reference, idempotency_key, rate_limit_key, hotel_id, room_id, service_type, guest_name, guest_contact,
   status, settled_amount_minor, settled_currency, hotel_commission_bps, created_at,
   settled_at, hotel_rate_minor, hotel_rate_currency, hotel_rate_bonus_applies, hotel_rate_counts_tier)
values
  -- The first hotel, September: two transfers and a tour, plus a cancellation.
  ('83000000-0000-4000-8000-000000000301', 'MG-SUMAAAAA', '83000000-0000-4000-8000-000000000401', 'sum-1',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'transport', 'G1', '+998900000001',
   'completed', 25000000, 'UZS', 1500, '2026-09-02T06:00:00+00',
   '2026-09-02T06:00:00+00', 200, 'USD', true, true),
  ('83000000-0000-4000-8000-000000000302', 'MG-SUMBBBBB', '83000000-0000-4000-8000-000000000402', 'sum-2',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'transport', 'G2', '+998900000002',
   'completed', 15000000, 'UZS', 1500, '2026-09-03T06:00:00+00',
   '2026-09-03T06:00:00+00', 200, 'USD', true, true),
  ('83000000-0000-4000-8000-000000000303', 'MG-SUMCCCCC', '83000000-0000-4000-8000-000000000403', 'sum-3',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'tours', 'G3', '+998900000003',
   'completed', 30000, 'USD', 1500, '2026-09-03T07:00:00+00',
   '2026-09-03T07:00:00+00', 800, 'USD', true, true),
  ('83000000-0000-4000-8000-000000000304', 'MG-SUMDDDDD', '83000000-0000-4000-8000-000000000404', 'sum-4',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'tours', 'G4', '+998900000004',
   'cancelled', null, null, null, '2026-09-03T08:00:00+00',
   null, null, null, null, null),
  -- Half past midnight on 1 October in Tashkent, which is still 30 September in
  -- UTC. It belongs to October, and must not be counted into September's tier.
  ('83000000-0000-4000-8000-000000000306', 'MG-SUMFFFFF', '83000000-0000-4000-8000-000000000406', 'sum-6',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'transport', 'G6', '+998900000006',
   'completed', 10000000, 'UZS', 1500, '2026-09-30T19:30:00+00',
   '2026-09-30T19:30:00+00', 200, 'USD', true, true),
  -- The second hotel, which the first must never see.
  ('83000000-0000-4000-8000-000000000305', 'MG-SUMEEEEE', '83000000-0000-4000-8000-000000000405', 'sum-5',
   '83000000-0000-4000-8000-000000000102', '83000000-0000-4000-8000-000000000202', 'tickets', 'G5', '+998900000005',
   'completed', 50000000, 'UZS', 1000, '2026-09-03T09:00:00+00',
   '2026-09-03T09:00:00+00', 200, 'USD', false, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- Turnover is nulled for the hotel, so transfers settled in som collapse into
-- one row: completed transport, completed tours, cancelled tours.
select is(
  (select count(*)::integer from public.settlement_summary(null, null)),
  3,
  'a hotel gets one row per service and status of its own requests'
);

select is(
  (select sum(requests)::integer from public.settlement_summary(null, null)),
  5,
  'and only its own five requests'
);

-- The whole point of the redesign: the hotel is paid per request, so it is
-- never shown what the service sold for.
select is(
  (select count(*)::integer from public.settlement_summary(null, null) where settled_amount_minor is not null),
  0,
  'a hotel is shown no turnover at all'
);

-- Three September requests and one October one, all at the ground tier: two
-- transfers at two dollars, one tour at eight, one more transfer in October.
select results_eq(
  $$ select payout_currency, sum(payout_minor)::bigint
     from public.settlement_summary(null, null)
     where status = 'completed'
     group by payout_currency $$,
  $$ values ('USD'::text, 1400::bigint) $$,
  'payouts are the frozen rates, in the payout currency'
);

select is(
  (select coalesce(sum(payout_minor), 0)::bigint from public.settlement_summary(null, null) where status = 'cancelled'),
  0::bigint,
  'a cancelled request owes nothing'
);

select is(
  (select requests::integer from public.settlement_summary(null, null)
   where service_type = 'transport' and status = 'completed'),
  3,
  'requests are counted by service'
);

-- Windows are half-open and use the same Asia/Tashkent boundary as the list.
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary('2026-09-03T00:00:00+05', '2026-09-04T00:00:00+05')),
  3,
  'a one-day window counts only that day'
);

-- The October request is the one settled at half past midnight Tashkent time.
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary('2026-10-01T00:00:00+05', null)),
  1,
  'a completion just after Tashkent midnight falls in the next month'
);

select is(
  (select coalesce(sum(payout_minor), 0)::bigint from public.settlement_summary('2026-11-01T00:00:00+05', null)),
  0::bigint,
  'a window with nothing in it owes nothing rather than failing'
);

-- The monthly bonus. Lowering the threshold to two puts September, which has
-- three completed requests, onto the middle rung; October, with one, stays on
-- the ground rung. That is what makes this a monthly figure rather than a
-- per-request one.
reset role;
update public.payout_tiers set min_requests = 2 where bonus_bps = 2000;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  (select coalesce(sum(payout_minor), 0)::bigint
   from public.settlement_summary('2026-09-01T00:00:00+05', '2026-10-01T00:00:00+05')),
  1440::bigint,
  'September earns the twenty percent step on every one of its requests'
);

select is(
  (select coalesce(sum(payout_minor), 0)::bigint
   from public.settlement_summary('2026-10-01T00:00:00+05', '2026-11-01T00:00:00+05')),
  200::bigint,
  'October is counted on its own and stays on the ground step'
);

-- A narrow window still reads the tier from the whole month it falls in, which
-- is the only way an arbitrary period can report an honest figure.
select is(
  (select coalesce(sum(payout_minor), 0)::bigint
   from public.settlement_summary('2026-09-03T00:00:00+05', '2026-09-04T00:00:00+05')),
  1200::bigint,
  'one day of September is priced at September''s tier, not its own count'
);

reset role;
update public.payout_tiers set min_requests = 15 where bonus_bps = 2000;
set local role authenticated;

-- The owner sees every hotel through the same function.
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select sum(requests)::integer from public.settlement_summary(null, null)),
  6,
  'the owner sees every request'
);

select is(
  (select count(distinct hotel_id)::integer from public.settlement_summary(null, null)),
  2,
  'grouped by hotel, so the owner can see what each is owed'
);

select is(
  (select coalesce(sum(settled_amount_minor), 0)::bigint
   from public.settlement_summary(null, null) where settled_currency = 'UZS'),
  100000000::bigint,
  'the owner does see the turnover, per currency'
);

-- Tickets carry a flat rate: the volume step never multiplies them.
select is(
  (select coalesce(sum(payout_minor), 0)::bigint
   from public.settlement_summary(null, null) where service_type = 'tickets'),
  200::bigint,
  'a ticket pays its flat rate whatever the month did'
);

-- A signed-in account with no admin row sees nothing at all.
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000099","role":"authenticated"}', true);
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary(null, null)),
  0,
  'an account with no role aggregates nothing'
);

reset role;
select * from finish();
rollback;
