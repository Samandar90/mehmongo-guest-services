-- Owner-recorded settlement.
--
-- public.service_requests carries no update grant for authenticated, on
-- purpose: a hotel that tries to edit the figures it is paid on is refused
-- outright rather than silently updating nothing. The owner's write therefore
-- goes through this routine.
--
-- security definer, unlike public.create_rooms_batch: that one is invoker
-- because public.rooms does have an update grant and RLS does the real work.
-- Here there is no grant to invoke with, so an invoker routine would be refused
-- for the owner too. Definer also bypasses RLS entirely, which makes the
-- is_super_admin() check the only thing standing between a hotel account and
-- another hotel's money: it is the first statement in the body and nothing may
-- ever be placed above it.
--
-- The commission is read here rather than accepted from the caller, so the
-- browser cannot choose the payout.
--
-- The status and the three money columns always move in ONE statement, because
-- service_requests_settlement_check is all-or-nothing in both directions.
-- offer_id and offer_snapshot are never named, so private.freeze_request_offer
-- passes untouched, and hotel_payout_minor is generated always: read back in
-- returning, never written.
--
-- The ceilings mirror settlementCurrencies in lib/admin/money.ts, the way
-- create_rooms_batch's limits mirror lib/admin/rooms.ts. UZS is settled in
-- whole som, USD in cents.

create or replace function public.settle_request(
  target_request_id uuid,
  new_status text,
  new_amount_minor bigint default null,
  new_currency text default null
)
returns table (
  request_status text,
  amount_minor bigint,
  currency_code text,
  frozen_commission_bps integer,
  payout_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Named so nothing collides with a column of service_requests or hotels:
  -- with an empty search_path an ambiguous unqualified reference fails.
  normalized_currency text := nullif(upper(btrim(coalesce(new_currency, ''))), '');
  amount_ceiling bigint;
begin
  if not private.is_super_admin() then
    raise exception 'only an active super admin can settle a request'
      using errcode = '42501';
  end if;

  if new_status is null or new_status not in ('new', 'confirmed', 'completed', 'cancelled') then
    raise exception 'unknown request status %', new_status
      using errcode = '22023';
  end if;

  if new_status = 'completed' then
    if new_amount_minor is null or normalized_currency is null then
      raise exception 'a completed request needs an amount and a currency'
        using errcode = '22023';
    end if;

    -- The column check only demands three uppercase letters, so it would accept
    -- EUR or XXX. The pilot settles in som or dollars; any other code would be
    -- stored at a scale nobody agreed on and could not be displayed honestly.
    amount_ceiling := case normalized_currency
      when 'UZS' then 1000000000
      when 'USD' then 10000000
    end;
    if amount_ceiling is null then
      raise exception 'settlement currency % is not one of UZS, USD', normalized_currency
        using errcode = '22023';
    end if;

    -- Zero is refused although the column permits it: a blank or mistyped field
    -- reads as zero far more often than a service is genuinely given away. An
    -- extra group of zeros is the other likely slip, hence the ceiling.
    if new_amount_minor <= 0 or new_amount_minor > amount_ceiling then
      raise exception 'settled amount % is outside the range allowed for %',
        new_amount_minor, normalized_currency
        using errcode = '22023';
    end if;
  elsif new_amount_minor is not null or normalized_currency is not null then
    -- Named rather than quietly dropped: a caller sending money with a
    -- cancellation has misunderstood which figure it holds.
    raise exception 'only a completed request carries an amount'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.service_requests where id = target_request_id) then
    raise exception 'request % does not exist', target_request_id
      using errcode = 'P0002';
  end if;

  return query
    update public.service_requests as request
    set status = new_status,
        settled_amount_minor = case when new_status = 'completed' then new_amount_minor end,
        settled_currency     = case when new_status = 'completed' then normalized_currency end,
        hotel_commission_bps = case
          when new_status <> 'completed' then null
          -- Already settled: the rate it was settled at stands, so correcting a
          -- mistyped amount next month cannot move the payout to a rate agreed
          -- after the work was done. The settlement check guarantees this
          -- column is null on every other status, so a stale rate cannot be
          -- picked up; only a genuine re-completion takes the current rate.
          when request.hotel_commission_bps is not null then request.hotel_commission_bps
          else (select hotel.commission_bps from public.hotels as hotel where hotel.id = request.hotel_id)
        end
    where request.id = target_request_id
    returning request.status,
              request.settled_amount_minor,
              request.settled_currency,
              request.hotel_commission_bps,
              request.hotel_payout_minor;
end;
$$;

comment on function public.settle_request(uuid, text, bigint, text) is
  'Records what a request became and, when completed, what it settled for. Owner only. The hotel commission is frozen from the hotel on the way into completed and kept while it stays completed; it is never taken from the caller.';

revoke all on function public.settle_request(uuid, text, bigint, text) from public;
revoke all on function public.settle_request(uuid, text, bigint, text) from anon;
-- service_role is revoked explicitly, not assumed absent: Supabase's default
-- privileges grant execute on a new public function to anon, authenticated and
-- service_role alike, so revoking from public and anon leaves service_role's
-- own grant in place. It could not pass the guard today, having no auth.uid(),
-- but a definer routine that writes past RLS on the money path must not be
-- reachable by the key whose whole purpose is bypassing RLS.
revoke all on function public.settle_request(uuid, text, bigint, text) from service_role;
grant execute on function public.settle_request(uuid, text, bigint, text) to authenticated;
