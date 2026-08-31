begin;
select plan(14);
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
select policies_are('public', 'hotels', array['super admins manage hotels']);
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
select * from finish();
rollback;
