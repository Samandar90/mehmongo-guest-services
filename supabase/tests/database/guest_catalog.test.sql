begin;
select plan(16);

-- Hotels can be attached to a guest catalogue; the column is optional and whitelisted.
select has_column('public'::name, 'hotels'::name, 'guest_catalog_id'::name, 'hotels has guest_catalog_id');
select col_is_null('public'::name, 'hotels'::name, 'guest_catalog_id'::name, 'guest_catalog_id is optional');

insert into public.hotels (id, slug, name)
values ('90000000-0000-4000-8000-000000000001', 'catalog-hotel', 'Catalog Hotel');

select is(
  (select guest_catalog_id from public.hotels where id = '90000000-0000-4000-8000-000000000001'),
  null,
  'a new hotel is not attached to any catalogue'
);

select lives_ok(
  $$ update public.hotels set guest_catalog_id = 'tashkent-v1' where id = '90000000-0000-4000-8000-000000000001' $$,
  'the Tashkent catalogue can be enabled for a hotel'
);

select throws_ok(
  $$ update public.hotels set guest_catalog_id = 'made-up-catalog' where id = '90000000-0000-4000-8000-000000000001' $$,
  '23514',
  null,
  'an unknown catalogue id is rejected'
);

-- Requests carry the selected offer and an immutable server snapshot.
select has_column('public'::name, 'service_requests'::name, 'offer_id'::name, 'service_requests has offer_id');
select has_column('public'::name, 'service_requests'::name, 'offer_snapshot'::name, 'service_requests has offer_snapshot');

insert into public.rooms (id, hotel_id, label)
values ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '301');

select results_eq(
  $$
    select outcome, reference is not null
    from public.submit_guest_request(
      'MG-CATALOG2',
      '90000000-0000-4000-8000-000000000010',
      'catalog-rate-key',
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002',
      'transport', 'Airport → hotel', '', '', '2099-12-31', '09:30', 2, 'Alex', '+998901234567', '',
      'tashkent-airport-sedan',
      '{"offerId":"tashkent-airport-sedan","priceMode":"from","amount":30,"currency":"USD"}'::jsonb
    )
  $$,
  $$ values ('created'::text, true) $$,
  'the atomic submit stores a catalogue request'
);

select is(
  (select offer_id from public.service_requests where reference = 'MG-CATALOG2'),
  'tashkent-airport-sedan',
  'the selected offer id is stored'
);

select is(
  (select offer_snapshot->>'amount' from public.service_requests where reference = 'MG-CATALOG2'),
  '30',
  'the server snapshot is stored with the request'
);

select throws_ok(
  $$ update public.service_requests set offer_snapshot = '{"amount":999}'::jsonb where reference = 'MG-CATALOG2' $$,
  'P0001',
  null,
  'the stored snapshot cannot be rewritten'
);

select throws_ok(
  $$ update public.service_requests set offer_id = 'tashkent-city-car' where reference = 'MG-CATALOG2' $$,
  'P0001',
  null,
  'the stored offer id cannot be rewritten'
);

-- Repeating the same idempotency key keeps the first request and its snapshot.
select results_eq(
  $$
    select outcome, reference
    from public.submit_guest_request(
      'MG-CATALOG3',
      '90000000-0000-4000-8000-000000000010',
      'catalog-rate-key',
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002',
      'tours', 'Different service', '', '', '2099-12-31', null, 2, 'Alex', '+998901234567', '',
      'tashkent-private-guide',
      '{"offerId":"tashkent-private-guide","priceMode":"from","amount":120,"currency":"USD"}'::jsonb
    )
  $$,
  $$ values ('existing'::text, 'MG-CATALOG2'::text) $$,
  'a repeated key returns the first request instead of overwriting it'
);

select is(
  (select offer_id from public.service_requests where reference = 'MG-CATALOG2'),
  'tashkent-airport-sedan',
  'the first snapshot survives a repeated key with another offer'
);

-- A request without a catalogue offer stays valid.
select results_eq(
  $$
    select outcome, request_id is not null
    from public.submit_guest_request(
      'MG-CATALOG4',
      '90000000-0000-4000-8000-000000000011',
      'catalog-legacy-key',
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002',
      'restaurants', 'Plov for four', '', '', '2099-12-31', '19:00', 4, 'Alex', '+998901234567', '',
      null,
      null
    )
  $$,
  $$ values ('created'::text, true) $$,
  'a request without an offer is still accepted'
);

select is(
  (select offer_id from public.service_requests where reference = 'MG-CATALOG4'),
  null,
  'a request without an offer stores no offer id'
);

select * from finish();
rollback;
