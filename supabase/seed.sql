insert into public.hotels (
  id,
  slug,
  name,
  address,
  commission_bps,
  active
) values (
  '10000000-0000-4000-8000-000000000001',
  'kamilovs',
  'Kamilovs Hotel',
  'Samarkand',
  0,
  true
);

insert into public.rooms (
  id,
  hotel_id,
  label,
  public_token,
  active
) values (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '205',
  '20000000-0000-4000-8000-000000000205',
  true
);
