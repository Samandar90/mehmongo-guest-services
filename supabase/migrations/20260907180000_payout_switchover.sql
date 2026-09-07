-- Switching the money path onto fixed rates, and taking the turnover away from
-- hotels.
--
-- Two changes that have to land together, because each one is what makes the
-- other safe:
--
--   * The payout stops being a share of the settled amount. Until now a hotel
--     could recover what a request sold for from its own payout and its own
--     commission rate, so hiding the amount would have been theatre.
--   * The hotel loses direct access to service_requests. A row policy cannot
--     hide a column, and PostgREST will filter on a column a role may select
--     even when the column is not requested — so `?select=id&
--     settled_amount_minor=gt.X` and a binary search would read the amount
--     back. The only reliable boundary is to stop handing hotels the table and
--     give them a function that returns a fixed set of columns.
--
-- The percentage columns are still here. Screens still read them; they go in
-- the next migration, once the application no longer does.

-- The month a payout belongs to, in the timezone the business runs in.
-- Tashkent is UTC+5 and has no daylight saving, but the offset is written once
-- here rather than being repeated at each call site.
create or replace function private.payout_month(at timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('month', $1 at time zone 'Asia/Tashkent')::date;
$$;

comment on function private.payout_month(timestamptz) is
  'The Asia/Tashkent calendar month a completed request is paid in. Payout is a monthly figure, so the boundary has to be one shared definition.';

revoke all on function private.payout_month(timestamptz) from public, anon, authenticated, service_role;

-- Settling a request.
--
-- The old signature returned the frozen commission and a computed payout, so
-- create or replace cannot be used: changing a return type needs a drop. The
-- grants are re-stated afterwards in full, because a fresh function picks up
-- Supabase's default privileges, which hand EXECUTE to anon.
drop function if exists public.settle_request(uuid, text, bigint, text);

create function public.settle_request(
  target_request_id uuid,
  new_status text,
  new_amount_minor bigint default null,
  new_currency text default null
)
-- The output names deliberately differ from the column names, as the previous
-- version did: with an empty search_path an unqualified reference that matches
-- both an OUT parameter and a column of service_requests is ambiguous, and the
-- failure would land at runtime on the money path.
returns table (
  request_status text,
  amount_minor bigint,
  currency_code text,
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
    -- The amount is what we sold it for. It no longer decides the payout, but
    -- it is still required: it is the only record of our own turnover, and the
    -- staff are expected to enter it on every completed request.
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

    select * into card from public.payout_rates where service_type = existing.service_type;
    if not found then
      raise exception 'no payout rate is configured for service %', existing.service_type
        using errcode = '22023';
    end if;
  elsif new_amount_minor is not null or normalized_currency is not null then
    raise exception 'only a completed request carries an amount'
      using errcode = '22023';
  end if;

  return query
    update public.service_requests as request
    set status = new_status,
        settled_amount_minor = case when new_status = 'completed' then new_amount_minor end,
        settled_currency     = case when new_status = 'completed' then normalized_currency end,
        -- Kept for the screens that still read it until the next migration.
        hotel_commission_bps = case
          when new_status <> 'completed' then null
          when request.hotel_commission_bps is not null then request.hotel_commission_bps
          else (select hotel.commission_bps from public.hotels as hotel where hotel.id = request.hotel_id)
        end,
        -- Set the first time the request is completed and never moved again.
        -- A cancellation followed by a re-completion must not slide a request
        -- into a later month: the work was done when it was first done, and
        -- that month may already be paid.
        settled_at = case
          when new_status <> 'completed' then request.settled_at
          when request.settled_at is not null then request.settled_at
          else now()
        end,
        -- Only the base rate is frozen. The monthly bonus is not a property of
        -- one request and cannot be stored on one.
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
              request.settled_at,
              request.hotel_rate_minor,
              request.hotel_rate_currency;
end;
$$;

comment on function public.settle_request(uuid, text, bigint, text) is
  'Records what a request became and what it sold for, and freezes the hotel base rate on first completion. Owner only. The rate is read from the rate card, never from the caller.';

revoke all on function public.settle_request(uuid, text, bigint, text) from public;
revoke all on function public.settle_request(uuid, text, bigint, text) from anon;
-- Explicitly, not by assumption: Supabase's default privileges grant EXECUTE on
-- a newly created public function to anon, authenticated and service_role
-- alike, and this one writes past RLS on the money path.
revoke all on function public.settle_request(uuid, text, bigint, text) from service_role;
grant execute on function public.settle_request(uuid, text, bigint, text) to authenticated;

-- Settlement totals, with the monthly tier applied.
--
-- security definer, and no longer invoker. The hotel is about to lose its row
-- policy on service_requests, so an invoker function would return it nothing.
-- The scoping that the policy used to do is done here, in one place, together
-- with the column list — which is the part a policy could never express.
--
-- Dropped first for the same reason as settle_request: the shape of the result
-- changes, and create or replace refuses to change a return type. The grants
-- are re-stated in full below, because the replacement is a new function and
-- inherits Supabase's defaults, which include EXECUTE for anon.
drop function if exists public.settlement_summary(timestamptz, timestamptz);

create function public.settlement_summary(
  from_at timestamptz default null,
  to_at timestamptz default null
)
returns table (
  hotel_id uuid,
  service_type text,
  status text,
  requests bigint,
  settled_currency text,
  settled_amount_minor bigint,
  payout_currency text,
  payout_minor bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select
      private.is_super_admin() as is_owner,
      private.admin_hotel_id() as own_hotel
  ),
  -- Every completed request of every month that the window touches, so the
  -- tier is read from the whole calendar month even when the window is a few
  -- days of it. The window itself is applied afterwards.
  visible as (
    select request.*
    from public.service_requests as request, caller
    where caller.is_owner or (caller.own_hotel is not null and request.hotel_id = caller.own_hotel)
  ),
  monthly as (
    select
      completed.hotel_id,
      private.payout_month(completed.settled_at) as month,
      count(*) filter (where coalesce(completed.hotel_rate_counts_tier, true)) as tier_requests
    from visible as completed
    where completed.status = 'completed' and completed.settled_at is not null
    group by 1, 2
  ),
  priced as (
    select
      completed.hotel_id,
      completed.service_type,
      completed.status,
      completed.settled_currency,
      completed.settled_amount_minor,
      completed.settled_at,
      completed.hotel_rate_currency,
      -- round() on numeric lands on the nearest minor unit; the bonus is basis
      -- points so the arithmetic stays integral.
      round(
        completed.hotel_rate_minor::numeric
        * (1 + case
                 when coalesce(completed.hotel_rate_bonus_applies, false)
                   then coalesce(tier.bonus_bps, 0)::numeric / 10000
                 else 0
               end)
      )::bigint as payout_minor
    from visible as completed
    join monthly
      on monthly.hotel_id = completed.hotel_id
     and monthly.month = private.payout_month(completed.settled_at)
    left join lateral (
      select step.bonus_bps
      from public.payout_tiers as step
      where step.min_requests <= monthly.tier_requests
      order by step.min_requests desc
      limit 1
    ) as tier on true
    where completed.status = 'completed'
      and completed.settled_at is not null
      and completed.hotel_rate_minor is not null
  ),
  settled_rows as (
    select
      priced.hotel_id,
      priced.service_type,
      priced.status,
      priced.settled_currency,
      priced.settled_amount_minor,
      priced.hotel_rate_currency,
      priced.payout_minor
    from priced
    where (from_at is null or priced.settled_at >= from_at)
      and (to_at is null or priced.settled_at < to_at)
  ),
  -- Anything not completed carries no money and is counted by when it was
  -- asked for, because it has no completion date to be counted by.
  open_rows as (
    select
      other.hotel_id,
      other.service_type,
      other.status,
      null::text as settled_currency,
      null::bigint as settled_amount_minor,
      null::text as hotel_rate_currency,
      null::bigint as payout_minor
    from visible as other
    where other.status <> 'completed'
      and (from_at is null or other.created_at >= from_at)
      and (to_at is null or other.created_at < to_at)
  ),
  everything as (
    select * from settled_rows
    union all
    select * from open_rows
  )
  select
    everything.hotel_id,
    everything.service_type,
    everything.status,
    count(*)::bigint as requests,
    -- The turnover belongs to the owner alone. A hotel is paid a fixed sum per
    -- request, so it never needs the figure, and it is not shown one.
    case when caller.is_owner then everything.settled_currency end,
    case when caller.is_owner then coalesce(sum(everything.settled_amount_minor), 0)::bigint end,
    everything.hotel_rate_currency,
    coalesce(sum(everything.payout_minor), 0)::bigint
  from everything, caller
  group by
    everything.hotel_id,
    everything.service_type,
    everything.status,
    everything.hotel_rate_currency,
    caller.is_owner,
    case when caller.is_owner then everything.settled_currency end;
$$;

comment on function public.settlement_summary(timestamptz, timestamptz) is
  'Request counts and hotel payouts, with the monthly volume bonus applied from the whole Asia/Tashkent calendar month each completion falls in. A hotel account sees its own hotel and no turnover; the owner sees every hotel and every figure. Returns no rows to a signed-in account that is neither.';

revoke all on function public.settlement_summary(timestamptz, timestamptz) from public;
revoke all on function public.settlement_summary(timestamptz, timestamptz) from anon;
revoke all on function public.settlement_summary(timestamptz, timestamptz) from service_role;
grant execute on function public.settlement_summary(timestamptz, timestamptz) to authenticated;

-- The hotel's own requests, without the money.
--
-- New surface, and the only one a hotel account has on the requests table from
-- here on. The column list is the security boundary, so it is written out in
-- full rather than selected with a star.
create or replace function public.hotel_requests(
  from_at timestamptz default null,
  to_at timestamptz default null,
  max_rows integer default 200
)
returns table (
  id uuid,
  reference text,
  created_at timestamptz,
  settled_at timestamptz,
  status text,
  service_type text,
  room_label text,
  payout_minor bigint,
  payout_currency text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    request.id,
    request.reference,
    request.created_at,
    request.settled_at,
    request.status,
    request.service_type,
    room.label,
    -- The per-request base rate only. The monthly bonus is a property of the
    -- month and is reported by settlement_summary, not smeared over rows.
    request.hotel_rate_minor,
    request.hotel_rate_currency
  from public.service_requests as request
  join public.rooms as room on room.id = request.room_id
  where request.hotel_id = private.admin_hotel_id()
    and private.admin_hotel_id() is not null
    and (from_at is null or request.created_at >= from_at)
    and (to_at is null or request.created_at < to_at)
  order by request.created_at desc
  limit greatest(1, least(coalesce(max_rows, 200), 500));
$$;

comment on function public.hotel_requests(timestamptz, timestamptz, integer) is
  'The list a hotel sees in its own cabinet: when, which room, which service, what it earned. No guest name, no guest contact, no turnover. Returns nothing to anyone who is not an active hotel account.';

revoke all on function public.hotel_requests(timestamptz, timestamptz, integer) from public;
revoke all on function public.hotel_requests(timestamptz, timestamptz, integer) from anon;
revoke all on function public.hotel_requests(timestamptz, timestamptz, integer) from service_role;
grant execute on function public.hotel_requests(timestamptz, timestamptz, integer) to authenticated;

-- And now the reason all of the above had to come first: the hotel no longer
-- reads the requests table.
--
-- Dropping this policy is what actually closes the turnover. Everything a
-- hotel legitimately needs is served by the two functions above, which name
-- their columns.
drop policy if exists "hotels read their own requests" on public.service_requests;

comment on table public.service_requests is
  'Guest requests. Direct reads are the owner''s alone: a row policy cannot hide a column, and PostgREST will filter on a column a role may select even when it is not in the select list. Hotels read through public.hotel_requests and public.settlement_summary, which return fixed column lists without the settled amount.';
