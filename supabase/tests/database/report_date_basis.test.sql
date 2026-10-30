begin;
select plan(25);

-- A request received on 9 October and completed on 24 October is the owner's
-- bug report: a period starting 12 October should not show it unless the owner
-- asked for the date of completion.

select function_privs_are(
  'public'::name, 'owner_request_timeline'::name,
  array['timestamptz', 'timestamptz', 'text']::name[],
  'anon'::name, array[]::text[],
  'anon cannot read the timeline'
);
select function_privs_are(
  'public'::name, 'owner_request_timeline'::name,
  array['timestamptz', 'timestamptz', 'text']::name[],
  'service_role'::name, array[]::text[],
  'the key that bypasses RLS cannot read it either'
);
select function_privs_are(
  'public'::name, 'owner_attention'::name,
  array[]::name[],
  'anon'::name, array[]::text[],
  'anon cannot read the attention counts'
);
select function_privs_are(
  'public'::name, 'owner_attention'::name,
  array[]::name[],
  'service_role'::name, array[]::text[],
  'the key that bypasses RLS cannot read them either'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('85000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'basis-owner@example.test', '', now(), now(), now()),
  ('85000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'basis-hotel@example.test', '', now(), now(), now());

insert into public.hotels (id, slug, name, commission_bps)
values ('85000000-0000-4000-8000-000000000101', 'basis-hotel', 'Basis Hotel', 1000);

insert into public.rooms (id, hotel_id, label)
values ('85000000-0000-4000-8000-000000000201', '85000000-0000-4000-8000-000000000101', '701');

insert into public.admin_users (user_id, role, active, hotel_id)
values
  ('85000000-0000-4000-8000-000000000001', 'super_admin', true, null),
  ('85000000-0000-4000-8000-000000000002', 'hotel', true, '85000000-0000-4000-8000-000000000101');

insert into public.service_requests
  (id, reference, idempotency_key, rate_limit_key, hotel_id, room_id, service_type, guest_name, guest_contact,
   status, settled_amount_minor, settled_currency, hotel_commission_bps, cost_amount_minor, cost_currency, created_at, requested_date,
   settled_at, hotel_rate_minor, hotel_rate_currency, hotel_rate_bonus_applies, hotel_rate_counts_tier)
values
  -- Received on the 9th, done on the 24th.
  ('85000000-0000-4000-8000-000000000301', 'MG-BASISAAA', '85000000-0000-4000-8000-000000000401', 'basis-1',
   '85000000-0000-4000-8000-000000000101', '85000000-0000-4000-8000-000000000201', 'tours', 'B1', '+998900000701',
   'completed', 1200000, 'UZS', 1000, 600000, 'UZS', '2026-10-09T03:49:00+00', '2026-10-09',
   '2026-10-24T18:08:00+00', 800, 'USD', true, true),
  -- Received and done on the 30th, with no cost entered yet.
  ('85000000-0000-4000-8000-000000000302', 'MG-BASISBBB', '85000000-0000-4000-8000-000000000402', 'basis-2',
   '85000000-0000-4000-8000-000000000101', '85000000-0000-4000-8000-000000000201', 'transport', 'B2', '+998900000702',
   'completed', 300000, 'UZS', 1000, null, null, '2026-10-30T10:00:00+00', '2026-10-30',
   '2026-10-30T11:00:00+00', 200, 'USD', true, true),
  -- Open, and its date has passed.
  ('85000000-0000-4000-8000-000000000303', 'MG-BASISCCC', '85000000-0000-4000-8000-000000000403', 'basis-3',
   '85000000-0000-4000-8000-000000000101', '85000000-0000-4000-8000-000000000201', 'transport', 'B3', '+998900000703',
   'confirmed', null, null, null, null, null, '2026-10-20T10:00:00+00', '2026-10-21',
   null, null, null, null, null),
  -- Open, and due today in Tashkent.
  ('85000000-0000-4000-8000-000000000304', 'MG-BASISDDD', '85000000-0000-4000-8000-000000000404', 'basis-4',
   '85000000-0000-4000-8000-000000000101', '85000000-0000-4000-8000-000000000201', 'transport', 'B4', '+998900000704',
   'new', null, null, null, null, null, '2026-10-20T11:00:00+00', (now() at time zone 'Asia/Tashkent')::date,
   null, null, null, null, null);

-- The first failed and went through on a retry; the second is still failing.
insert into public.telegram_deliveries (request_id, attempt, status)
values
  ('85000000-0000-4000-8000-000000000301', 1, 'failed'),
  ('85000000-0000-4000-8000-000000000301', 2, 'sent'),
  ('85000000-0000-4000-8000-000000000302', 1, 'failed');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- The report itself.
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary('2026-10-12T00:00:00+05', '2026-11-01T00:00:00+05', 'created')
   where status = 'completed'),
  1,
  'read by the date of the request, the 9 October request stays out of a period from the 12th'
);
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary('2026-10-12T00:00:00+05', '2026-11-01T00:00:00+05', 'settled')
   where status = 'completed'),
  2,
  'read by the date of completion, it is in'
);
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary('2026-10-09T00:00:00+05', '2026-10-10T00:00:00+05', 'created')),
  1,
  'and it is found on the day it arrived'
);
select is(
  (select coalesce(sum(requests), 0)::integer from public.settlement_summary('2026-10-12T00:00:00+05', '2026-11-01T00:00:00+05')
   where status = 'completed'),
  2,
  'with no basis named the meaning stays what the hotel cabinet relies on'
);
select is(
  (select coalesce(sum(payout_minor), 0)::bigint from public.settlement_summary('2026-10-09T00:00:00+05', '2026-10-10T00:00:00+05', 'created')),
  800::bigint,
  'the basis picks the rows, not what they pay'
);
select throws_ok(
  $$ select * from public.settlement_summary(null, null, 'yesterday') $$,
  '22023', null, 'an unknown basis is refused rather than quietly reading another date'
);

-- The money follows the same reading.
select is(
  (select coalesce(sum(revenue_minor), 0)::bigint from public.owner_profit_summary('2026-10-12T00:00:00+05', '2026-11-01T00:00:00+05', 'created')),
  300000::bigint,
  'revenue read by the date of the request leaves it out too'
);
select is(
  (select coalesce(sum(revenue_minor), 0)::bigint from public.owner_profit_summary('2026-10-12T00:00:00+05', '2026-11-01T00:00:00+05', 'settled')),
  1500000::bigint,
  'and read by completion includes it'
);
select throws_ok(
  $$ select * from public.owner_profit_summary(null, null, 'yesterday') $$,
  '22023', null, 'the margin report refuses an unknown basis as well'
);

-- The chart adds up to the counters beside it.
select is(
  (select day from public.owner_request_timeline('2026-10-09T00:00:00+05', '2026-10-10T00:00:00+05', 'created')),
  '2026-10-09'::date,
  'the timeline places a request on the day it arrived'
);
select is(
  (select day from public.owner_request_timeline('2026-10-24T00:00:00+05', '2026-10-25T00:00:00+05', 'settled')),
  '2026-10-24'::date,
  'or on the day it was completed'
);
select is(
  (select day from public.owner_request_timeline('2026-10-24T00:00:00+05', '2026-10-25T00:00:00+05', 'settled')),
  (select (settled_at at time zone 'Asia/Tashkent')::date from public.service_requests where reference = 'MG-BASISAAA'),
  'and the day is a Tashkent day, the one the completion time is shown in'
);
select is(
  (select sum(requests)::integer from public.owner_request_timeline(null, null, 'created')),
  (select sum(requests)::integer from public.settlement_summary(null, null, 'created')),
  'the bars add up to the counters'
);

select throws_ok(
  $$ select * from public.owner_request_timeline(null, null, 'yesterday') $$,
  '22023', null, 'so does the timeline, with the period open'
);

-- What needs a hand. A request that failed and then went through is not one.
select is((select overdue_open from public.owner_attention()), 1::bigint, 'an open request whose date has passed is counted');
select is((select due_today from public.owner_attention()), 1::bigint, 'so is one due today');
select is((select telegram_failed from public.owner_attention()), 1::bigint, 'only a latest failed delivery counts as failed');
select is((select missing_cost from public.owner_attention()), 1::bigint, 'and a completed request with no cost');

-- None of it reaches a hotel.
select set_config('request.jwt.claims', '{"sub":"85000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.owner_request_timeline(null, null, 'created')),
  0,
  'a hotel gets no timeline'
);
select is(
  (select overdue_open + due_today + telegram_failed + missing_cost from public.owner_attention()),
  0::bigint,
  'and no attention counts'
);
select is(
  (select count(*)::integer from public.settlement_summary(null, null, 'created') where settled_amount_minor is not null),
  0,
  'and the created basis shows it no turnover either'
);

reset role;
select * from finish();
rollback;
