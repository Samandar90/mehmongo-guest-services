begin;
select plan(19);

-- The supplier cost and the margin it produces.
--
-- This is the most private figure in the system: it is what we pay, and no
-- hotel-facing surface may reach it. The assertions below are the whole of
-- that guarantee.

select has_column('public'::name, 'service_requests'::name, 'cost_amount_minor'::name, 'a request can carry what it cost us');

select function_privs_are(
  'public'::name, 'owner_profit_summary'::name,
  array['timestamptz', 'timestamptz']::name[],
  'anon'::name, array[]::text[],
  'anon cannot execute the margin report'
);
select function_privs_are(
  'public'::name, 'owner_profit_summary'::name,
  array['timestamptz', 'timestamptz']::name[],
  'service_role'::name, array[]::text[],
  'the key that bypasses RLS cannot execute it either'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('84000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cost-owner@example.test', '', now(), now(), now()),
  ('84000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cost-hotel@example.test', '', now(), now(), now());

insert into public.hotels (id, slug, name, commission_bps)
values ('84000000-0000-4000-8000-000000000101', 'cost-hotel', 'Cost Hotel', 1000);

insert into public.rooms (id, hotel_id, label)
values ('84000000-0000-4000-8000-000000000201', '84000000-0000-4000-8000-000000000101', '601');

insert into public.admin_users (user_id, role, active, hotel_id)
values
  ('84000000-0000-4000-8000-000000000001', 'super_admin', true, null),
  ('84000000-0000-4000-8000-000000000002', 'hotel', true, '84000000-0000-4000-8000-000000000101');

insert into public.service_requests
  (id, reference, idempotency_key, rate_limit_key, hotel_id, room_id, service_type, guest_name, guest_contact)
values
  ('84000000-0000-4000-8000-000000000301', 'MG-COSTAAAA', '84000000-0000-4000-8000-000000000401', 'cost-1',
   '84000000-0000-4000-8000-000000000101', '84000000-0000-4000-8000-000000000201', 'transport', 'C1', '+998900000601'),
  ('84000000-0000-4000-8000-000000000302', 'MG-COSTBBBB', '84000000-0000-4000-8000-000000000402', 'cost-2',
   '84000000-0000-4000-8000-000000000101', '84000000-0000-4000-8000-000000000201', 'tours', 'C2', '+998900000602');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"84000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Sold for 300 000 сум, cost us 200 000: margin is 100 000.
select results_eq(
  $$ select amount_minor, cost_minor from public.settle_request(
       '84000000-0000-4000-8000-000000000301', 'completed', 300000, 'UZS', 200000) $$,
  $$ values (300000::bigint, 200000::bigint) $$,
  'a completed request records what it sold for and what it cost'
);

-- The cost is optional: it is often known a day after the sale.
select results_eq(
  $$ select cost_minor from public.settle_request(
       '84000000-0000-4000-8000-000000000302', 'completed', 1500000, 'UZS') $$,
  $$ values (null::bigint) $$,
  'a completed request without a cost is accepted'
);

-- Correcting a mistyped price must not wipe the supplier figure: re-settling
-- with no cost keeps the one already recorded.
select results_eq(
  $$ select amount_minor, cost_minor from public.settle_request(
       '84000000-0000-4000-8000-000000000301', 'completed', 320000, 'UZS') $$,
  $$ values (320000::bigint, 200000::bigint) $$,
  'settling again without a cost keeps the cost already recorded'
);

select throws_ok(
  $$ select * from public.settle_request('84000000-0000-4000-8000-000000000301', 'confirmed', null, null, 5000) $$,
  '22023', null, 'a cost on a request that has not completed is refused'
);

select throws_ok(
  $$ select * from public.settle_request('84000000-0000-4000-8000-000000000301', 'completed', 300000, 'UZS', 9999999999) $$,
  '22023', null, 'a cost past the currency ceiling is refused'
);

-- The margin report.
select is(
  (select margin_minor from public.owner_profit_summary(null, null) where service_type = 'transport'),
  120000::bigint,
  'margin is what was sold for minus what it cost'
);

select is(
  (select costed_requests from public.owner_profit_summary(null, null) where service_type = 'tours'),
  0::bigint,
  'a request with no cost is counted but adds nothing to margin'
);

select is(
  (select margin_minor from public.owner_profit_summary(null, null) where service_type = 'tours'),
  0::bigint,
  'and a missing cost is not read as pure profit'
);

select is(
  (select requests from public.owner_profit_summary(null, null) where service_type = 'tours'),
  1::bigint,
  'the request still appears, so an unfinished month reads as incomplete'
);

select is(
  (select coalesce(sum(requests), 0)::integer from public.owner_profit_summary('2099-01-01T00:00:00+05', null)),
  0,
  'a window with nothing in it reports nothing rather than failing'
);

-- The whole point: the hotel cannot reach any of it.
select set_config('request.jwt.claims', '{"sub":"84000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  (select coalesce(sum(requests), 0)::integer from public.owner_profit_summary(null, null)),
  0,
  'a hotel account gets an empty margin report'
);

select is(
  (select count(*)::integer from public.service_requests where cost_amount_minor is not null),
  0,
  'and cannot read the cost off the table either'
);

select is(
  (select count(*)::integer from public.service_requests where cost_amount_minor > 1),
  0,
  'nor probe it with a filter'
);

select throws_ok(
  $$ select cost_amount_minor from public.hotel_requests() $$,
  '42703',
  null,
  'hotel_requests has no cost column to select'
);

select throws_ok(
  $$ select * from public.settle_request('84000000-0000-4000-8000-000000000301', 'completed', 1, 'UZS', 1) $$,
  '42501',
  null,
  'and cannot write a cost of its own'
);

-- An account with no admin row at all.
select set_config('request.jwt.claims', '{"sub":"84000000-0000-4000-8000-000000000099","role":"authenticated"}', true);
select is(
  (select coalesce(sum(requests), 0)::integer from public.owner_profit_summary(null, null)),
  0,
  'an account with no role sees no margin'
);

reset role;
select * from finish();
rollback;
