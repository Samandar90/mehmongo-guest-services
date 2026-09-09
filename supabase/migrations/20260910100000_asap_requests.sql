-- A guest in the room usually wants the car now, not at a time they have to
-- invent. A transfer can be sent as "as soon as possible": the request carries
-- the Tashkent date it was sent on and no time, and the team confirms the
-- nearest pickup. The flag is a column so a retry and the admin read it back
-- without parsing the note.

alter table public.service_requests
  add column asap boolean not null default false;

-- An "as soon as possible" request has no time by definition; a row with both
-- would leave the team guessing which one the guest meant.
alter table public.service_requests
  add constraint service_requests_asap_no_time_check
    check (not asap or requested_time is null);

comment on column public.service_requests.asap is
  'The guest asked for the nearest possible time instead of naming one. requested_time is null when set.';

-- A new parameter is a new signature: create or replace would leave the old
-- function beside this one, so the old one is dropped and the grants restated.
drop function if exists public.submit_guest_request(
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text, text, jsonb, text
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
  p_offer_snapshot jsonb default null,
  p_guest_locale text default 'en',
  p_asap boolean default false
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
      offer_snapshot,
      guest_locale,
      asap
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
      p_offer_snapshot,
      p_guest_locale,
      coalesce(p_asap, false)
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
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text, text, jsonb, text, boolean
) from public;
revoke all on function public.submit_guest_request(
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text, text, jsonb, text, boolean
) from anon, authenticated;
grant execute on function public.submit_guest_request(
  text, uuid, text, uuid, uuid, text, text, text, text, date, time without time zone, integer, text, text, text, text, jsonb, text, boolean
) to service_role;
