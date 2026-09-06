begin;
select plan(13);

-- public.settlement_summary aggregates in the database, so a hotel with more
-- requests than one page still gets a true total. It runs security invoker, so
-- the rows it counts are exactly the rows the caller may read: a hotel sees its
-- own, the owner sees every hotel.

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
  'authenticated'::name, array['EXECUTE']::text[],
  'a signed-in account may call it, and sees only its own rows'
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

insert into public.service_requests
  (id, reference, idempotency_key, rate_limit_key, hotel_id, room_id, service_type, guest_name, guest_contact,
   status, settled_amount_minor, settled_currency, hotel_commission_bps, created_at)
values
  -- The first hotel: two som settlements, one dollar settlement, one cancelled.
  ('83000000-0000-4000-8000-000000000301', 'MG-SUMAAAAA', '83000000-0000-4000-8000-000000000401', 'sum-1',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'transport', 'G1', '+998900000001',
   'completed', 25000000, 'UZS', 1500, '2026-09-02T06:00:00+00'),
  ('83000000-0000-4000-8000-000000000302', 'MG-SUMBBBBB', '83000000-0000-4000-8000-000000000402', 'sum-2',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'transport', 'G2', '+998900000002',
   'completed', 15000000, 'UZS', 1500, '2026-09-03T06:00:00+00'),
  ('83000000-0000-4000-8000-000000000303', 'MG-SUMCCCCC', '83000000-0000-4000-8000-000000000403', 'sum-3',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'tours', 'G3', '+998900000003',
   'completed', 30000, 'USD', 1500, '2026-09-03T07:00:00+00'),
  ('83000000-0000-4000-8000-000000000304', 'MG-SUMDDDDD', '83000000-0000-4000-8000-000000000404', 'sum-4',
   '83000000-0000-4000-8000-000000000101', '83000000-0000-4000-8000-000000000201', 'tours', 'G4', '+998900000004',
   'cancelled', null, null, null, '2026-09-03T08:00:00+00'),
  -- The second hotel, which the first must never see.
  ('83000000-0000-4000-8000-000000000305', 'MG-SUMEEEEE', '83000000-0000-4000-8000-000000000405', 'sum-5',
   '83000000-0000-4000-8000-000000000102', '83000000-0000-4000-8000-000000000202', 'tickets', 'G5', '+998900000005',
   'completed', 50000000, 'UZS', 1000, '2026-09-03T09:00:00+00');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- Two som transport settlements collapse into one row; the dollar tour and the
-- cancelled tour are their own.
select is(
  (select count(*)::integer from public.settlement_summary(null, null)),
  3,
  'a hotel gets one row per service, status and currency of its own requests'
);

select is(
  (select sum(requests)::integer from public.settlement_summary(null, null)),
  4,
  'and only its own four requests'
);

-- Som and dollars are never added together: each currency totals on its own.
select results_eq(
  $$ select settled_currency, sum(hotel_payout_minor)::bigint
     from public.settlement_summary(null, null)
     where status = 'completed'
     group by settled_currency
     order by settled_currency $$,
  $$ values ('USD'::text, 4500::bigint), ('UZS'::text, 6000000::bigint) $$,
  'payouts total per currency, never mixed'
);

select is(
  (select coalesce(sum(hotel_payout_minor), 0)::bigint from public.settlement_summary(null, null) where status = 'cancelled'),
  0::bigint,
  'a cancelled request owes nothing'
);

select is(
  (select requests::integer from public.settlement_summary(null, null)
   where service_type = 'transport' and status = 'completed' and settled_currency = 'UZS'),
  2,
  'requests are counted by service'
);

-- The period is bounded by the caller, in the same half-open way the admin list uses.
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary('2026-09-03T00:00:00+05', '2026-09-04T00:00:00+05')),
  3,
  'a one-day window counts only that day'
);

select is(
  (select coalesce(sum(hotel_payout_minor), 0)::bigint from public.settlement_summary('2026-09-04T00:00:00+05', null)),
  0::bigint,
  'a window with nothing in it owes nothing rather than failing'
);

-- The owner sees every hotel through the same function.
select set_config('request.jwt.claims', '{"sub":"83000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select sum(requests)::integer from public.settlement_summary(null, null)),
  5,
  'the owner sees every request'
);

select is(
  (select count(distinct hotel_id)::integer from public.settlement_summary(null, null)),
  2,
  'grouped by hotel, so the owner can see what each is owed'
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
