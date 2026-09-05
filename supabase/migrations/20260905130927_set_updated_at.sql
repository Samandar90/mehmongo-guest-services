-- Keep updated_at honest: advance it on every row update regardless of the
-- payload the client sends. clock_timestamp() (not now()) so the stamp moves
-- even for updates issued inside the transaction that created the row.

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;
grant execute on function private.set_updated_at() to authenticated, service_role;

create trigger set_updated_at
before update on public.admin_users
for each row execute function private.set_updated_at();

create trigger set_updated_at
before update on public.hotels
for each row execute function private.set_updated_at();

create trigger set_updated_at
before update on public.rooms
for each row execute function private.set_updated_at();

create trigger set_updated_at
before update on public.service_requests
for each row execute function private.set_updated_at();
