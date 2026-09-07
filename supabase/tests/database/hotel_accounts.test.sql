begin;
select plan(30);

-- A hotel account is an admin_users row scoped to one hotel. The owner records
-- what a request settled for; the hotel only ever reads its own numbers.

select has_column('public'::name, 'admin_users'::name, 'hotel_id'::name, 'admin_users has hotel_id');
select has_column('public'::name, 'service_requests'::name, 'settled_amount_minor'::name, 'requests carry a settled amount');
select has_column('public'::name, 'service_requests'::name, 'settled_currency'::name, 'requests carry the settled currency');
select has_column('public'::name, 'service_requests'::name, 'hotel_commission_bps'::name, 'requests freeze the commission');
select has_column('public'::name, 'service_requests'::name, 'hotel_payout_minor'::name, 'requests expose the payout');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('81000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', '', now(), now(), now()),
  ('81000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'first-hotel@example.test', '', now(), now(), now()),
  ('81000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'second-hotel@example.test', '', now(), now(), now());

insert into public.hotels (id, slug, name, commission_bps)
values
  ('81000000-0000-4000-8000-000000000101', 'first-hotel', 'First Hotel', 1500),
  ('81000000-0000-4000-8000-000000000102', 'second-hotel', 'Second Hotel', 1000);

insert into public.rooms (id, hotel_id, label)
values
  ('81000000-0000-4000-8000-000000000201', '81000000-0000-4000-8000-000000000101', '101'),
  ('81000000-0000-4000-8000-000000000202', '81000000-0000-4000-8000-000000000102', '202');

insert into public.admin_users (user_id, role, active, hotel_id)
values ('81000000-0000-4000-8000-000000000001', 'super_admin', true, null);

-- A hotel account must name its hotel; a super admin must not.
select throws_ok(
  $$ insert into public.admin_users (user_id, role, active, hotel_id)
     values ('81000000-0000-4000-8000-000000000002', 'hotel', true, null) $$,
  '23514',
  null,
  'a hotel account without a hotel is rejected'
);

select throws_ok(
  $$ insert into public.admin_users (user_id, role, active, hotel_id)
     values ('81000000-0000-4000-8000-000000000003', 'super_admin', true, '81000000-0000-4000-8000-000000000101') $$,
  '23514',
  null,
  'a super admin scoped to one hotel is rejected'
);

insert into public.admin_users (user_id, role, active, hotel_id)
values
  ('81000000-0000-4000-8000-000000000002', 'hotel', true, '81000000-0000-4000-8000-000000000101'),
  ('81000000-0000-4000-8000-000000000003', 'hotel', true, '81000000-0000-4000-8000-000000000102');

insert into public.service_requests
  (id, reference, idempotency_key, rate_limit_key, hotel_id, room_id, service_type, guest_name, guest_contact)
values
  ('81000000-0000-4000-8000-000000000301', 'MG-SETTLEAB', '81000000-0000-4000-8000-000000000401', 'settle-key-1',
   '81000000-0000-4000-8000-000000000101', '81000000-0000-4000-8000-000000000201', 'transport', 'First Guest', '+998900000001'),
  ('81000000-0000-4000-8000-000000000302', 'MG-SETTLECD', '81000000-0000-4000-8000-000000000402', 'settle-key-2',
   '81000000-0000-4000-8000-000000000102', '81000000-0000-4000-8000-000000000202', 'tours', 'Second Guest', '+998900000002');

-- The lifecycle a request may take.
select lives_ok(
  $$ update public.service_requests set status = 'confirmed' where id = '81000000-0000-4000-8000-000000000301' $$,
  'a request can be confirmed'
);

select throws_ok(
  $$ update public.service_requests set status = 'invented' where id = '81000000-0000-4000-8000-000000000301' $$,
  '23514',
  null,
  'an unknown status is rejected'
);

-- Money may only exist on a request that actually completed.
select throws_ok(
  $$ update public.service_requests
     set settled_amount_minor = 5000, settled_currency = 'USD', hotel_commission_bps = 1500
     where id = '81000000-0000-4000-8000-000000000302' $$,
  '23514',
  null,
  'an amount on a request that has not completed is rejected'
);

select throws_ok(
  $$ update public.service_requests set status = 'completed' where id = '81000000-0000-4000-8000-000000000301' $$,
  '23514',
  null,
  'completing a request without an amount is rejected'
);

select throws_ok(
  $$ update public.service_requests
     set status = 'completed', settled_amount_minor = -100, settled_currency = 'USD', hotel_commission_bps = 1500
     where id = '81000000-0000-4000-8000-000000000301' $$,
  '23514',
  null,
  'a negative amount is rejected'
);

select lives_ok(
  $$ update public.service_requests
     set status = 'completed', settled_amount_minor = 30000, settled_currency = 'USD', hotel_commission_bps = 1500
     where id = '81000000-0000-4000-8000-000000000301' $$,
  'a completed request carries its amount and the frozen commission'
);

-- The payout is derived, so the owner's number and the hotel's number are one number.
select is(
  (select hotel_payout_minor from public.service_requests where id = '81000000-0000-4000-8000-000000000301'),
  4500::bigint,
  '15% of 300.00 is 45.00'
);

select is(
  (select hotel_payout_minor from public.service_requests where id = '81000000-0000-4000-8000-000000000302'),
  null,
  'an unsettled request owes nothing'
);

-- A real Tashkent bill, settled in som. UZS carries no minor unit in practice,
-- so the som is the minor unit here and the stored figure is the som figure.
select lives_ok(
  $$ update public.service_requests
     set status = 'completed', settled_amount_minor = 25000000, settled_currency = 'UZS', hotel_commission_bps = 1500
     where id = '81000000-0000-4000-8000-000000000302' $$,
  'a 25 million som settlement is storable'
);

select is(
  (select hotel_payout_minor from public.service_requests where id = '81000000-0000-4000-8000-000000000302'),
  3750000::bigint,
  '15% of 25 000 000 som is 3 750 000 som'
);

update public.service_requests
set status = 'new', settled_amount_minor = null, settled_currency = null, hotel_commission_bps = null
where id = '81000000-0000-4000-8000-000000000302';

-- Renegotiating the rate must not rewrite what was already earned.
update public.hotels set commission_bps = 2500 where id = '81000000-0000-4000-8000-000000000101';
select is(
  (select hotel_payout_minor from public.service_requests where id = '81000000-0000-4000-8000-000000000301'),
  4500::bigint,
  'a later commission change leaves a settled payout alone'
);

set local role authenticated;

-- The hotel account of the first hotel.
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

-- The requests table itself is now the owner's alone.
select is(
  (select count(*)::integer from public.service_requests),
  0,
  'a hotel no longer reads the requests table directly'
);

-- What it reads instead, scoped to itself by the function.
select is(
  (select count(*)::integer from public.hotel_requests()),
  1,
  'a hotel reads its own requests through hotel_requests'
);

select is(
  (select count(*)::integer from public.hotels),
  1,
  'a hotel reads only its own hotel'
);

select is(
  (select count(*)::integer from public.rooms),
  1,
  'a hotel reads only its own rooms'
);

-- The turnover is the owner's figure. The hotel is paid a fixed rate per
-- request, so it never needs to know what the service sold for — and must not
-- be able to find out.
select is(
  (select count(*)::integer from public.service_requests where settled_amount_minor is not null),
  0,
  'a hotel cannot read what any request settled for'
);

select throws_ok(
  $$ select settled_amount_minor from public.hotel_requests() $$,
  '42703',
  null,
  'hotel_requests has no settled amount to select'
);

-- Filtering is the path a column list alone would not close: PostgREST lets a
-- role filter on a column it may select even when it does not request it, so a
-- binary search would read the amount back. There is nothing left to filter.
select is(
  (select count(*)::integer from public.service_requests where settled_amount_minor > 1),
  0,
  'a hotel cannot probe the amount with a filter either'
);

select throws_ok(
  $$ update public.service_requests set settled_amount_minor = 999999 where id = '81000000-0000-4000-8000-000000000301' $$,
  '42501',
  null,
  'a hotel cannot change the amount it is paid on'
);

select is(
  (select count(*)::integer from public.hotels where id = '81000000-0000-4000-8000-000000000102'),
  0,
  'a hotel cannot reach another hotel by id'
);

-- The client learns its own role from this row, so the account must reach it.
select is(
  (select role from public.admin_users where user_id = '81000000-0000-4000-8000-000000000002'),
  'hotel',
  'an account reads its own row to learn its role'
);

-- A disabled hotel account loses access entirely.
reset role;
update public.admin_users set active = false where user_id = '81000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.service_requests),
  0,
  'a disabled hotel account sees nothing'
);

-- The owner keeps the whole picture.
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  (select count(*)::integer from public.service_requests),
  2,
  'the super admin still sees every request'
);

reset role;
select * from finish();
rollback;
