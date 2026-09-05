-- The admin requests screen lists everything newest-first before any filter is
-- applied; every existing composite index leads with a filter column.
create index if not exists service_requests_created_idx
  on public.service_requests (created_at desc);
