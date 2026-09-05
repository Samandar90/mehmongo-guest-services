-- Guest service catalogue.
--
-- A hotel joins a catalogue only when the owner enables it explicitly; hotels
-- without an attachment keep the previous guest form. A request may record the
-- offer the guest chose plus a server-built snapshot of what was shown, so the
-- request history never changes when the catalogue is updated.

alter table public.hotels
  add column guest_catalog_id text
    check (guest_catalog_id in ('tashkent-v1'));

comment on column public.hotels.guest_catalog_id is
  'Guest catalogue shown for this hotel. Null keeps the previous guest form. Enabled per hotel by the owner.';

alter table public.service_requests
  add column offer_id text check (char_length(offer_id) between 1 and 80),
  add column offer_snapshot jsonb;

comment on column public.service_requests.offer_snapshot is
  'Immutable record of the public offer shown to the guest (title, version, price mode and starting amount). Built on the server, never from client input.';

-- The snapshot is evidence of what the guest saw; nothing may rewrite it later.
create or replace function private.freeze_request_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.offer_id is distinct from old.offer_id then
    raise exception 'offer_id of a stored request cannot be changed'
      using errcode = 'P0001';
  end if;
  if new.offer_snapshot is distinct from old.offer_snapshot then
    raise exception 'offer_snapshot of a stored request cannot be changed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function private.freeze_request_offer() from public;
grant execute on function private.freeze_request_offer() to authenticated, service_role;

create trigger freeze_request_offer
before update on public.service_requests
for each row execute function private.freeze_request_offer();

create index service_requests_offer_created_idx
  on public.service_requests (offer_id, created_at desc)
  where offer_id is not null;

-- Atomic submission carries the offer and its snapshot in the same transaction
-- as the request itself; a separate insert afterwards could not be trusted.
drop function if exists public.submit_guest_request(
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text
);

create function public.submit_guest_request(
  p_reference text,
  p_idempotency_key uuid,
  p_rate_limit_key text,
  p_hotel_id uuid,
  p_room_id uuid,
  p_service_type text,
  p_choice text,
  p_pickup text,
  p_destination text,
  p_requested_date date,
  p_requested_time time without time zone,
  p_party_size integer,
  p_guest_name text,
  p_guest_contact text,
  p_note text,
  p_offer_id text default null,
  p_offer_snapshot jsonb default null
)
returns table (outcome text, request_id uuid, reference text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_request_id uuid;
  existing_reference text;
  recent_request_count bigint;
  conflicting_constraint text;
begin
  select request.id, request.reference
  into existing_request_id, existing_reference
  from public.service_requests as request
  where request.idempotency_key = p_idempotency_key;

  if found then
    return query select 'existing'::text, existing_request_id, existing_reference;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_rate_limit_key, 0));

  select request.id, request.reference
  into existing_request_id, existing_reference
  from public.service_requests as request
  where request.idempotency_key = p_idempotency_key;

  if found then
    return query select 'existing'::text, existing_request_id, existing_reference;
    return;
  end if;

  select count(*)
  into recent_request_count
  from public.service_requests as request
  where request.rate_limit_key = p_rate_limit_key
    and request.created_at >= now() - interval '10 minutes';

  if recent_request_count >= 5 then
    return query select 'rate_limited'::text, null::uuid, null::text;
    return;
  end if;

  begin
    insert into public.service_requests as inserted (
      reference,
      idempotency_key,
      rate_limit_key,
      hotel_id,
      room_id,
      service_type,
      choice,
      pickup,
      destination,
      requested_date,
      requested_time,
      party_size,
      guest_name,
      guest_contact,
      note,
      offer_id,
      offer_snapshot
    ) values (
      p_reference,
      p_idempotency_key,
      p_rate_limit_key,
      p_hotel_id,
      p_room_id,
      p_service_type,
      p_choice,
      p_pickup,
      p_destination,
      p_requested_date,
      p_requested_time,
      p_party_size,
      p_guest_name,
      p_guest_contact,
      p_note,
      p_offer_id,
      p_offer_snapshot
    )
    returning inserted.id, inserted.reference into existing_request_id, existing_reference;
  exception when unique_violation then
    get stacked diagnostics conflicting_constraint = constraint_name;
    if conflicting_constraint = 'service_requests_idempotency_key_key' then
      select request.id, request.reference
      into existing_request_id, existing_reference
      from public.service_requests as request
      where request.idempotency_key = p_idempotency_key;

      if found then
        return query select 'existing'::text, existing_request_id, existing_reference;
        return;
      end if;
    end if;
    raise;
  end;

  insert into public.telegram_deliveries (request_id, attempt, status)
  values (existing_request_id, 1, 'pending');

  return query select 'created'::text, existing_request_id, existing_reference;
end;
$$;

revoke all on function public.submit_guest_request(
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text, text, jsonb
) from public;
revoke all on function public.submit_guest_request(
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text, text, jsonb
) from anon, authenticated;
grant execute on function public.submit_guest_request(
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text, text, jsonb
) to service_role;
