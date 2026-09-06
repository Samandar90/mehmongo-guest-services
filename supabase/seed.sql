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

-- Two rooms, because several checks need one room to disable while another
-- stays reachable. Both tokens are deterministic so local guest links survive
-- a reset; 206 used to be inserted by hand and was lost on the next one.
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
), (
  '20000000-0000-4000-8000-000000000206',
  '10000000-0000-4000-8000-000000000001',
  '206',
  '20000000-0000-4000-8000-000000000206',
  true
);
