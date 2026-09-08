begin;
select plan(26);

-- public.settle_request is the only way the owner writes money onto a request.
-- It runs security definer, so its own is_super_admin() check is the whole of
-- the authorization: these assertions are what stands between a hotel account
-- and another hotel's figures.

select has_function('public'::name, 'settle_request'::name, 'settle_request exists');
select function_returns('public'::name, 'settle_request'::name, 'setof record', 'it returns the stored settlement');

select function_privs_are(
  'public'::name, 'settle_request'::name,
  array['uuid', 'text', 'bigint', 'text', 'bigint']::name[],
  'anon'::name, array[]::text[],
  'anon cannot execute it'
);
select function_privs_are(
  'public'::name, 'settle_request'::name,
  array['uuid', 'text', 'bigint', 'text', 'bigint']::name[],
  'service_role'::name, array[]::text[],
  'the key that bypasses RLS cannot execute it either'
);
select function_privs_are(
  'public'::name, 'settle_request'::name,
  array['uuid', 'text', 'bigint', 'text', 'bigint']::name[],
  'authenticated'::name, array['EXECUTE']::text[],
  'authenticated may call it, and is authorized inside'
);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('82000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'settle-owner@example.test', '', now(), now(), now()),
  ('82000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'settle-hotel@example.test', '', now(), now(), now()),
  ('82000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'settle-nobody@example.test', '', now(), now(), now());

insert into public.hotels (id, slug, name, commission_bps)
values ('82000000-0000-4000-8000-000000000101', 'settle-hotel', 'Settle Hotel', 1500);

insert into public.rooms (id, hotel_id, label)
values ('82000000-0000-4000-8000-000000000201', '82000000-0000-4000-8000-000000000101', '401');

insert into public.admin_users (user_id, role, active, hotel_id)
values
  ('82000000-0000-4000-8000-000000000001', 'super_admin', true, null),
  ('82000000-0000-4000-8000-000000000002', 'hotel', true, '82000000-0000-4000-8000-000000000101');

insert into public.service_requests
  (id, reference, idempotency_key, rate_limit_key, hotel_id, room_id, service_type, guest_name, guest_contact, offer_id, offer_snapshot)
values (
  '82000000-0000-4000-8000-000000000301', 'MG-SETTLERA', '82000000-0000-4000-8000-000000000401', 'settle-rpc-key',
  '82000000-0000-4000-8000-000000000101', '82000000-0000-4000-8000-000000000201', 'transport', 'Settle Guest', '+998900000401',
  'tashkent-airport-sedan', '{"offerId":"tashkent-airport-sedan","title":"Your airport ride, arranged","priceMode":"from","amount":30}'::jsonb
);

set local role authenticated;

-- Who may not settle.
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 25000000, 'UZS') $$,
  '42501',
  null,
  'the hotel being paid cannot settle its own request'
);

select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'confirmed') $$,
  '42501',
  null,
  'a signed-in account that is no administrator cannot settle'
);

reset role;
update public.admin_users set active = false where user_id = '82000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'confirmed') $$,
  '42501',
  null,
  'a deactivated owner cannot settle'
);

reset role;
update public.admin_users set active = true where user_id = '82000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- What the owner may not send.
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'invented') $$,
  '22023', null, 'an unknown status is refused'
);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000399', 'confirmed') $$,
  'P0002', null, 'an unknown request is reported as missing'
);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed') $$,
  '22023', null, 'completing without an amount is refused'
);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 25000000, null) $$,
  '22023', null, 'completing without a currency is refused'
);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 0, 'UZS') $$,
  '22023', null, 'a zero amount is refused rather than read as a free service'
);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 1000000001, 'UZS') $$,
  '22023', null, 'an extra group of zeros is caught by the ceiling'
);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 5000, 'EUR') $$,
  '22023', null, 'a currency outside som and dollars is refused'
);
select throws_ok(
  $$ select * from public.settle_request('82000000-0000-4000-8000-000000000301', 'cancelled', 25000000, 'UZS') $$,
  '22023', null, 'money sent with a cancellation is named, not dropped'
);

-- What the owner may do.
select results_eq(
  $$ select request_status, amount_minor, currency_code, rate_minor, rate_currency_code
     from public.settle_request('82000000-0000-4000-8000-000000000301', 'confirmed') $$,
  $$ values ('confirmed'::text, null::bigint, null::text, null::bigint, null::text) $$,
  'confirming records no money'
);

-- The fixture is a transport request, so the rate card pays two dollars. The
-- amount it sold for is recorded but no longer decides the payout.
select results_eq(
  $$ select request_status, amount_minor, currency_code, rate_minor, rate_currency_code
     from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 25000000, 'UZS') $$,
  $$ values ('completed'::text, 25000000::bigint, 'UZS'::text, 200::bigint, 'USD'::text) $$,
  'completing records the turnover and freezes the rate card price'
);

select isnt(
  (select completed_at from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 25000000, 'UZS')),
  null,
  'a completed request carries the moment it was completed'
);

select results_eq(
  $$ select currency_code from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 30050, 'usd') $$,
  $$ values ('USD'::text) $$,
  'a lower-case currency is stored upper-cased'
);

-- Raising the rate card must not repay work that was already done.
reset role;
update public.payout_rates set rate_minor = 500 where service_type = 'transport';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$ select rate_minor from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 30000, 'USD') $$,
  $$ values (200::bigint) $$,
  'correcting the amount keeps the rate the work was settled at'
);

select results_eq(
  $$ select request_status, amount_minor, currency_code
     from public.settle_request('82000000-0000-4000-8000-000000000301', 'cancelled') $$,
  $$ values ('cancelled'::text, null::bigint, null::text) $$,
  'cancelling clears the amount and the currency'
);

-- Deliberately unlike the old percentage, which was re-taken on every fresh
-- completion. The completion date decides which month is paid, and months get
-- closed and paid out: letting a cancel-and-redo slide a request into a later
-- month at a newer rate would rewrite a month that is already settled.
select results_eq(
  $$ select rate_minor from public.settle_request('82000000-0000-4000-8000-000000000301', 'completed', 30000, 'USD') $$,
  $$ values (200::bigint) $$,
  'completing again after a cancellation keeps the original rate'
);

reset role;
update public.payout_rates set rate_minor = 200 where service_type = 'transport';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- The settlement must not disturb what the guest was shown.
select is(
  (select offer_snapshot ->> 'amount' from public.service_requests where id = '82000000-0000-4000-8000-000000000301'),
  '30',
  'the offer snapshot survives settlement untouched'
);

select isnt(
  (select updated_at from public.service_requests where id = '82000000-0000-4000-8000-000000000301'),
  (select created_at from public.service_requests where id = '82000000-0000-4000-8000-000000000301'),
  'settling advances updated_at'
);

-- The routine is the only door: the table itself stays shut.
select set_config('request.jwt.claims', '{"sub":"82000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ update public.service_requests set settled_amount_minor = 1 where id = '82000000-0000-4000-8000-000000000301' $$,
  '42501', null, 'a hotel still cannot write to the table directly'
);

reset role;
select * from finish();
rollback;
