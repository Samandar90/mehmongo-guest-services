begin;
select plan(11);

-- Fixtures: one hotel with an existing room, one super admin, one plain authenticated user.
insert into public.hotels (id, slug, name)
values ('80000000-0000-4000-8000-000000000001', 'batch-hotel', 'Batch Hotel');

insert into public.rooms (id, hotel_id, label)
values ('80000000-0000-4000-8000-000000000002', '80000000-0000-4000-8000-000000000001', '101');

insert into auth.users (id, email)
values
  ('80000000-0000-4000-8000-000000000010', 'batch-owner@example.test'),
  ('80000000-0000-4000-8000-000000000011', 'batch-guest@example.test');

insert into public.admin_users (user_id, role)
values ('80000000-0000-4000-8000-000000000010', 'super_admin');

select ok(
  to_regprocedure('public.create_rooms_batch(uuid, text[])') is not null,
  'create_rooms_batch(uuid, text[]) exists'
);

select ok(
  not has_function_privilege('anon', 'public.create_rooms_batch(uuid, text[])', 'execute'),
  'anon cannot execute create_rooms_batch'
);

select ok(
  has_function_privilege('authenticated', 'public.create_rooms_batch(uuid, text[])', 'execute'),
  'authenticated can execute create_rooms_batch (authorization happens inside)'
);

-- Anonymous execution is denied.
savepoint anon_call;
set local role anon;
select throws_ok(
  $$ select * from public.create_rooms_batch('80000000-0000-4000-8000-000000000001', array['102']) $$,
  '42501',
  null,
  'anonymous execution is denied'
);
rollback to savepoint anon_call;

-- Authenticated user without an admin profile is denied.
savepoint guest_call;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.create_rooms_batch('80000000-0000-4000-8000-000000000001', array['102']) $$,
  '42501',
  null,
  'non-admin execution is denied'
);
rollback to savepoint guest_call;

-- Super admin creates every label in one statement.
savepoint admin_call;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-4000-8000-000000000010","role":"authenticated"}', true);
select results_eq(
  $$ select label, active from public.create_rooms_batch('80000000-0000-4000-8000-000000000001', array['102', ' 103 ', 'Villa 3']) order by label $$,
  $$ values ('102'::text, true), ('103'::text, true), ('Villa 3'::text, true) $$,
  'super admin receives all created rooms with trimmed labels'
);
select is(
  (select count(*) from public.rooms where hotel_id = '80000000-0000-4000-8000-000000000001'),
  4::bigint,
  'rooms are persisted for the target hotel'
);

-- A conflicting label rolls back the whole batch.
select throws_ok(
  $$ select * from public.create_rooms_batch('80000000-0000-4000-8000-000000000001', array['104', '101']) $$,
  '23505',
  null,
  'duplicate label fails the batch'
);
select is(
  (select count(*) from public.rooms where hotel_id = '80000000-0000-4000-8000-000000000001' and label = '104'),
  0::bigint,
  'no room from the failed batch is persisted'
);

-- Input validation happens server-side.
select throws_ok(
  $$ select * from public.create_rooms_batch('80000000-0000-4000-8000-000000000001', array['105', repeat('x', 41)]) $$,
  '22023',
  null,
  'labels longer than 40 characters are rejected'
);
select throws_ok(
  $$ select * from public.create_rooms_batch('80000000-0000-4000-8000-000000000099', array['106']) $$,
  'P0002',
  null,
  'unknown hotel is rejected'
);
rollback to savepoint admin_call;

select * from finish();
rollback;
