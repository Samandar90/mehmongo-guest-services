begin;
select plan(1);

select has_index(
  'public'::name,
  'service_requests'::name,
  'service_requests_created_idx'::name,
  'service_requests has a plain created_at index for the unfiltered admin listing'
);

select * from finish();
rollback;
