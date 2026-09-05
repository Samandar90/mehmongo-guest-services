begin;
select plan(4);

insert into public.hotels (id, slug, name, updated_at)
values ('60000000-0000-4000-8000-000000000001', 'stamp-hotel', 'Stamp Hotel', '2020-01-01T00:00:00Z');

insert into public.rooms (id, hotel_id, label, updated_at)
values ('60000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000001', '101', '2020-01-01T00:00:00Z');

update public.hotels set name = 'Stamp Hotel Renamed' where id = '60000000-0000-4000-8000-000000000001';
select ok(
  (select updated_at > '2020-01-01T00:00:00Z' from public.hotels where id = '60000000-0000-4000-8000-000000000001'),
  'hotel update advances updated_at'
);

update public.hotels set updated_at = '2019-01-01T00:00:00Z', address = 'Client stamp' where id = '60000000-0000-4000-8000-000000000001';
select ok(
  (select updated_at > '2020-01-01T00:00:00Z' from public.hotels where id = '60000000-0000-4000-8000-000000000001'),
  'hotel update ignores a client-supplied updated_at'
);

update public.rooms set active = false where id = '60000000-0000-4000-8000-000000000002';
select ok(
  (select updated_at > '2020-01-01T00:00:00Z' from public.rooms where id = '60000000-0000-4000-8000-000000000002'),
  'room update advances updated_at'
);

select ok(
  (select created_at < updated_at from public.hotels where id = '60000000-0000-4000-8000-000000000001'),
  'created_at is left untouched by updates'
);

select * from finish();
rollback;
