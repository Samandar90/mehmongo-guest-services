-- What each completed request cost us, and the profit that falls out of it.
--
-- Until now a request recorded what it sold for and what the hotel earns. The
-- third figure — what we paid the supplier — lived only in the owner's head,
-- so margin could not be reported by the product at all.
--
-- It is the most private number in the system. A hotel already cannot read
-- service_requests, and neither of the two functions it does read names these
-- columns; the reporting function below is owner-only on top of that.

alter table public.service_requests
  add column cost_amount_minor bigint check (cost_amount_minor >= 0),
  add column cost_currency text check (cost_currency ~ '^[A-Z]{3}$');

comment on column public.service_requests.cost_amount_minor is
  'What we paid the supplier for this request, in minor units of cost_currency. The owner''s figure alone: no hotel-facing function selects it.';

-- A cost is optional — it is often known a day later than the sale — but when
-- it exists it belongs to a completed request and shares that request's
-- currency. Subtracting som from dollars is the one arithmetic this codebase
-- refuses to do, so the shape makes it impossible rather than merely unwise.
alter table public.service_requests
  add constraint service_requests_cost_check check (
    (cost_amount_minor is null and cost_currency is null)
    or (
      cost_amount_minor is not null
      and cost_currency is not null
      and status = 'completed'
      and cost_currency = settled_currency
    )
  );

create index service_requests_cost_idx
  on public.service_requests (hotel_id, settled_at)
  where status = 'completed' and cost_amount_minor is not null;

-- settle_request takes the cost too.
--
-- Dropped and recreated rather than replaced: the argument list changes, and
-- the grants are re-stated in full because a fresh function inherits Supabase's
-- defaults, which hand EXECUTE to anon.
drop function if exists public.settle_request(uuid, text, bigint, text);

create function public.settle_request(
  target_request_id uuid,
  new_status text,
  new_amount_minor bigint default null,
  new_currency text default null,
  new_cost_minor bigint default null
)
returns table (
  request_status text,
  amount_minor bigint,
  currency_code text,
  cost_minor bigint,
  completed_at timestamptz,
  rate_minor bigint,
  rate_currency_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_currency text := nullif(upper(btrim(coalesce(new_currency, ''))), '');
  amount_ceiling bigint;
  card public.payout_rates%rowtype;
  existing public.service_requests%rowtype;
begin
  if not private.is_super_admin() then
    raise exception 'only an active super admin can settle a request'
      using errcode = '42501';
  end if;

  if new_status is null or new_status not in ('new', 'confirmed', 'completed', 'cancelled') then
    raise exception 'unknown status %', new_status
      using errcode = '22023';
  end if;

  select * into existing from public.service_requests where id = target_request_id;
  if not found then
    raise exception 'request % does not exist', target_request_id
      using errcode = 'P0002';
  end if;

  if new_status = 'completed' then
    if new_amount_minor is null or normalized_currency is null then
      raise exception 'a completed request needs an amount and a currency'
        using errcode = '22023';
    end if;

    amount_ceiling := case normalized_currency
      when 'UZS' then 1000000000
      when 'USD' then 10000000
    end;
    if amount_ceiling is null then
      raise exception 'settlement currency % is not one of UZS, USD', normalized_currency
        using errcode = '22023';
    end if;

    if new_amount_minor <= 0 or new_amount_minor > amount_ceiling then
      raise exception 'settled amount % is outside the range allowed for %',
        new_amount_minor, normalized_currency
        using errcode = '22023';
    end if;

    -- The cost may be left out and filled in later, but a nonsense one is
    -- refused now rather than quietly poisoning every margin report.
    if new_cost_minor is not null and (new_cost_minor < 0 or new_cost_minor > amount_ceiling) then
      raise exception 'cost % is outside the range allowed for %',
        new_cost_minor, normalized_currency
        using errcode = '22023';
    end if;

    select * into card from public.payout_rates where service_type = existing.service_type;
    if not found then
      raise exception 'no payout rate is configured for service %', existing.service_type
        using errcode = '22023';
    end if;
  else
    if new_amount_minor is not null or normalized_currency is not null then
      raise exception 'only a completed request carries an amount'
        using errcode = '22023';
    end if;
    if new_cost_minor is not null then
      raise exception 'only a completed request carries a cost'
        using errcode = '22023';
    end if;
  end if;

  return query
    update public.service_requests as request
    set status = new_status,
        settled_amount_minor = case when new_status = 'completed' then new_amount_minor end,
        settled_currency     = case when new_status = 'completed' then normalized_currency end,
        -- Unlike the amount, the cost is not cleared by re-settling without
        -- one: correcting a mistyped price must not silently erase what we
        -- already recorded paying the supplier.
        cost_amount_minor = case
          when new_status <> 'completed' then null
          when new_cost_minor is not null then new_cost_minor
          else request.cost_amount_minor
        end,
        cost_currency = case
          when new_status <> 'completed' then null
          when new_cost_minor is not null then normalized_currency
          when request.cost_amount_minor is not null then normalized_currency
          else null
        end,
        hotel_commission_bps = case
          when new_status <> 'completed' then null
          when request.hotel_commission_bps is not null then request.hotel_commission_bps
          else (select hotel.commission_bps from public.hotels as hotel where hotel.id = request.hotel_id)
        end,
        settled_at = case
          when new_status <> 'completed' then request.settled_at
          when request.settled_at is not null then request.settled_at
          else now()
        end,
        hotel_rate_minor = case
          when new_status <> 'completed' then request.hotel_rate_minor
          when request.hotel_rate_minor is not null then request.hotel_rate_minor
          else card.rate_minor
        end,
        hotel_rate_currency = case
          when new_status <> 'completed' then request.hotel_rate_currency
          when request.hotel_rate_currency is not null then request.hotel_rate_currency
          else card.currency
        end,
        hotel_rate_bonus_applies = case
          when new_status <> 'completed' then request.hotel_rate_bonus_applies
          when request.hotel_rate_bonus_applies is not null then request.hotel_rate_bonus_applies
          else card.tier_bonus_applies
        end,
        hotel_rate_counts_tier = case
          when new_status <> 'completed' then request.hotel_rate_counts_tier
          when request.hotel_rate_counts_tier is not null then request.hotel_rate_counts_tier
          else card.counts_toward_tier
        end
    where request.id = target_request_id
    returning request.status,
              request.settled_amount_minor,
              request.settled_currency,
              request.cost_amount_minor,
              request.settled_at,
              request.hotel_rate_minor,
              request.hotel_rate_currency;
end;
$$;

comment on function public.settle_request(uuid, text, bigint, text, bigint) is
  'Records what a request became, what it sold for, what it cost us, and freezes the hotel base rate on first completion. Owner only. A cost left out keeps whatever was recorded before.';

revoke all on function public.settle_request(uuid, text, bigint, text, bigint) from public;
revoke all on function public.settle_request(uuid, text, bigint, text, bigint) from anon;
revoke all on function public.settle_request(uuid, text, bigint, text, bigint) from service_role;
grant execute on function public.settle_request(uuid, text, bigint, text, bigint) to authenticated;

-- The owner's margin report.
--
-- Grouped by currency as well as by service, because a request settled in som
-- and one settled in dollars have no common total. The hotel payout is not
-- folded in here: it is paid in dollars whatever the sale was settled in, so
-- it is reported by settlement_summary and subtracted per currency by the
-- screen, not by pretending the two are the same money.
create or replace function public.owner_profit_summary(
  from_at timestamptz default null,
  to_at timestamptz default null
)
returns table (
  service_type text,
  currency text,
  requests bigint,
  costed_requests bigint,
  revenue_minor bigint,
  cost_minor bigint,
  margin_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.service_type,
    request.settled_currency,
    count(*)::bigint,
    count(*) filter (where request.cost_amount_minor is not null)::bigint,
    coalesce(sum(request.settled_amount_minor), 0)::bigint,
    coalesce(sum(request.cost_amount_minor), 0)::bigint,
    -- Only requests that carry a cost contribute to margin. Counting a request
    -- with no cost as pure profit would overstate every report until the last
    -- supplier invoice is entered.
    coalesce(sum(request.settled_amount_minor - request.cost_amount_minor), 0)::bigint
  from public.service_requests as request
  where private.is_super_admin()
    and request.status = 'completed'
    and request.settled_at is not null
    and (from_at is null or request.settled_at >= from_at)
    and (to_at is null or request.settled_at < to_at)
  group by request.service_type, request.settled_currency;
$$;

comment on function public.owner_profit_summary(timestamptz, timestamptz) is
  'Revenue, supplier cost and margin per service and currency, for the owner alone. Returns no rows to anyone else. Margin counts only requests that have a cost recorded, so an unfinished month reads as incomplete rather than as pure profit.';

revoke all on function public.owner_profit_summary(timestamptz, timestamptz) from public;
revoke all on function public.owner_profit_summary(timestamptz, timestamptz) from anon;
revoke all on function public.owner_profit_summary(timestamptz, timestamptz) from service_role;
grant execute on function public.owner_profit_summary(timestamptz, timestamptz) to authenticated;
