begin;
select plan(33);
select has_table('public'::name, 'admin_users'::name);
select has_table('public'::name, 'hotels'::name);
select has_table('public'::name, 'rooms'::name);
select has_table('public'::name, 'service_requests'::name);
select has_table('public'::name, 'telegram_deliveries'::name);
select has_column('public'::name, 'hotels'::name, 'commission_bps'::name, 'hotels has commission_bps');
select col_is_unique('public'::name, 'rooms'::name, 'public_token'::name, 'rooms.public_token is unique');
select col_is_unique('public'::name, 'service_requests'::name, 'reference'::name, 'service_requests.reference is unique');
select col_is_unique('public'::name, 'service_requests'::name, 'idempotency_key'::name, 'service_requests.idempotency_key is unique');
select has_index('public'::name, 'service_requests'::name, 'service_requests_hotel_created_idx'::name);
select has_index('public'::name, 'service_requests'::name, 'service_requests_rate_limit_idx'::name);
select policies_are('public', 'hotels', array['super admins manage hotels', 'hotels read their own hotel']);
-- The hotel's own policy is gone on purpose. A row policy cannot hide a
-- column, and PostgREST filters on any column the role may select even when it
-- is not requested, so leaving it would leave the settled amount reachable.
-- Hotels read through public.hotel_requests and public.settlement_summary.
select policies_are('public', 'service_requests', array['super admins read requests']);

insert into public.hotels (id, slug, name)
values
  ('30000000-0000-4000-8000-000000000001', 'hotel-a', 'Hotel A'),
  ('30000000-0000-4000-8000-000000000002', 'hotel-b', 'Hotel B');

insert into public.rooms (id, hotel_id, label)
values (
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '101'
);

select throws_ok(
  $$
    insert into public.service_requests (
      idempotency_key,
      rate_limit_key,
      hotel_id,
      room_id,
      service_type,
      guest_name,
      guest_contact
    ) values (
      '30000000-0000-4000-8000-000000000004',
      'test-rate-key',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      'tours',
      'Test Guest',
      '+0000000000'
    )
  $$,
  '23503'::char(5),
  null,
  'mismatched hotel and room are rejected'
);

select ok(
  to_regprocedure('public.submit_guest_request(text,uuid,text,uuid,uuid,text,text,text,text,date,time without time zone,integer,text,text,text,text,jsonb,text,boolean)') is not null,
  'atomic submit function exists'
);

select ok(
  has_function_privilege(
    'service_role',
    to_regprocedure('public.submit_guest_request(text,uuid,text,uuid,uuid,text,text,text,text,date,time without time zone,integer,text,text,text,text,jsonb,text,boolean)'),
    'EXECUTE'
  ),
  'service_role can execute atomic submit function'
);

select ok(
  not has_function_privilege(
    'anon',
    to_regprocedure('public.submit_guest_request(text,uuid,text,uuid,uuid,text,text,text,text,date,time without time zone,integer,text,text,text,text,jsonb,text,boolean)'),
    'EXECUTE'
  ),
  'anon cannot execute atomic submit function'
);

select ok(
  not has_function_privilege(
    'authenticated',
    to_regprocedure('public.submit_guest_request(text,uuid,text,uuid,uuid,text,text,text,text,date,time without time zone,integer,text,text,text,text,jsonb,text,boolean)'),
    'EXECUTE'
  ),
  'authenticated cannot execute atomic submit function'
);

select ok(
  pg_get_functiondef(to_regprocedure('public.submit_guest_request(text,uuid,text,uuid,uuid,text,text,text,text,date,time without time zone,integer,text,text,text,text,jsonb,text,boolean)'))
    like '%pg_advisory_xact_lock%',
  'atomic submit function takes an advisory transaction lock'
);

select results_eq(
  $$
    select outcome, reference, request_id is not null
    from public.submit_guest_request(
      'MG-ATOMICAB',
      '40000000-0000-4000-8000-000000000001',
      'atomic-idempotency-rate-key',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      'transport', '', 'Hotel A', 'Airport', '2099-12-31', '14:30', 2, 'Alex', '+998901234567', ''
    )
  $$,
  $$values ('created'::text, 'MG-ATOMICAB'::text, true)$$,
  'atomic submit returns the created request id'
);

select results_eq(
  $$
    select outcome, reference,
      request_id = (select id from public.service_requests where reference = 'MG-ATOMICAB')
    from public.submit_guest_request(
      'MG-ATOMICCD',
      '40000000-0000-4000-8000-000000000001',
      'atomic-idempotency-rate-key',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      'transport', '', 'Hotel A', 'Airport', '2099-12-31', '14:30', 2, 'Alex', '+998901234567', ''
    )
  $$,
  $$values ('existing'::text, 'MG-ATOMICAB'::text, true)$$,
  'atomic submit returns the existing request id without creating another request'
);

select results_eq(
  $$
    select delivery.attempt, delivery.status
    from public.telegram_deliveries as delivery
    join public.service_requests as request on request.id = delivery.request_id
    where request.reference = 'MG-ATOMICAB'
  $$,
  $$values (1::integer, 'pending'::text)$$,
  'atomic submit creates exactly one pending first Telegram attempt'
);

select results_eq(
  $$
    select outcome
    from (
      select request_number, (
        public.submit_guest_request(
          'MG-RATEAAA' || chr(ascii('A') + request_number - 1),
          ('50000000-0000-4000-8000-' || lpad(request_number::text, 12, '0'))::uuid,
          'atomic-rate-key',
          '30000000-0000-4000-8000-000000000001',
          '30000000-0000-4000-8000-000000000003',
          'transport', '', 'Hotel A', 'Airport', '2099-12-31', '14:30', 2, 'Alex', '+998901234567', ''
        )
      ).outcome
      from generate_series(1, 5) as series(request_number)
    ) outcomes
    order by request_number
  $$,
  $$values ('created'::text), ('created'::text), ('created'::text), ('created'::text), ('created'::text)$$,
  'atomic submit accepts five matching requests'
);

select results_eq(
  $$
    select outcome, reference
    from public.submit_guest_request(
      'MG-RATEAAAF',
      '50000000-0000-4000-8000-000000000006',
      'atomic-rate-key',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      'transport', '', 'Hotel A', 'Airport', '2099-12-31', '14:30', 2, 'Alex', '+998901234567', ''
    )
  $$,
  $$values ('rate_limited'::text, null::text)$$,
  'atomic submit rejects the sixth matching request'
);

select has_column('public'::name, 'service_requests'::name, 'guest_locale'::name, 'service_requests has guest_locale');

select is(
  (select guest_locale from public.service_requests where reference = 'MG-ATOMICAB'),
  'en',
  'a request that does not say its language is English'
);

select results_eq(
  $$
    select outcome
    from public.submit_guest_request(
      'MG-LOCALEZH',
      '40000000-0000-4000-8000-000000000002',
      'atomic-locale-rate-key',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      'transport', '', 'Hotel A', 'Airport', '2099-12-31', '14:30', 2, 'Alex', '+998901234567', '',
      null, null, 'zh'
    )
  $$,
  $$values ('created'::text)$$,
  'atomic submit accepts the language the guest was reading'
);

-- Read in a statement of its own: a scalar subquery beside the call sees the
-- snapshot from before the function ran, not the row it inserted.
select is(
  (select guest_locale from public.service_requests where reference = 'MG-LOCALEZH'),
  'zh',
  'atomic submit stores the language the guest was reading'
);

select throws_ok(
  $$
    select * from public.submit_guest_request(
      'MG-LOCALEDE',
      '40000000-0000-4000-8000-000000000003',
      'atomic-locale-rate-key',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      'transport', '', 'Hotel A', 'Airport', '2099-12-31', '14:30', 2, 'Alex', '+998901234567', '',
      null, null, 'de'
    )
  $$,
  '23514'::char(5),
  null,
  'a language the site does not speak is refused by the constraint'
);

select has_column('public'::name, 'service_requests'::name, 'asap'::name, 'service_requests has asap');

select results_eq(
  $$
    select outcome
    from public.submit_guest_request(
      'MG-ASAPAAAA',
      '40000000-0000-4000-8000-000000000004',
      'atomic-asap-rate-key',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      'transport', '', 'Hotel A', 'Airport', '2099-12-31', null, 2, 'Alex', '+998901234567', '',
      null, null, 'en', true
    )
  $$,
  $$values ('created'::text)$$,
  'atomic submit accepts an as-soon-as-possible request without a time'
);

select is(
  (select asap from public.service_requests where reference = 'MG-ASAPAAAA'),
  true,
  'the as-soon-as-possible flag is stored'
);

select throws_ok(
  $$
    select * from public.submit_guest_request(
      'MG-ASAPBBBB',
      '40000000-0000-4000-8000-000000000005',
      'atomic-asap-rate-key',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000003',
      'transport', '', 'Hotel A', 'Airport', '2099-12-31', '14:30', 2, 'Alex', '+998901234567', '',
      null, null, 'en', true
    )
  $$,
  '23514'::char(5),
  null,
  'an as-soon-as-possible request may not also name a time'
);
select * from finish();
rollback;
