-- Which date a report period is read against, and the owner's two new views.
--
-- The overview counted a completed request by when it was completed, while the
-- request list filtered by when it arrived. A request received on 9 October and
-- marked done on 24 October therefore appeared in a period starting 12 October,
-- and could not be found with the same dates in the list.
--
-- Both readings are legitimate, so the caller now says which one it means:
--
--   'created' -- when the guest sent it. What the owner means by "that week".
--   'settled' -- when it was first completed. What decides the month it is paid
--                in, and the default, so the hotel cabinet keeps its meaning.
--
-- Whichever is chosen, the volume step is still read from the Asia/Tashkent month
-- of completion: the basis picks which rows are shown, never what a row pays.

create function private.report_date_basis(requested text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if requested is null or requested not in ('created', 'settled') then
    raise exception 'unknown date basis %', requested
      using errcode = '22023';
  end if;
  return requested;
end;
$$;

comment on function private.report_date_basis(text) is
  'Refuses a report date basis other than created or settled, so a mistyped value is an error rather than a silently different report. Callers put it in the WHERE clause: selected in a CTE it is dropped by the planner whenever the period is open, and the check silently never runs.';

revoke all on function private.report_date_basis(text) from public, anon, authenticated, service_role;

-- Dropped and recreated: the argument list changes, and the grants are re-stated
-- in full because a fresh function inherits Supabase's defaults, which hand
-- EXECUTE to anon.
drop function if exists public.settlement_summary(timestamptz, timestamptz);

create function public.settlement_summary(
  from_at timestamptz default null,
  to_at timestamptz default null,
  date_basis text default 'settled'
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
      completed.created_at,
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
    where (from_at is null
           or case when date_basis = 'created' then priced.created_at else priced.settled_at end >= from_at)
      and (to_at is null
           or case when date_basis = 'created' then priced.created_at else priced.settled_at end < to_at)
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
  where private.report_date_basis(date_basis) is not null
  group by
    everything.hotel_id,
    everything.service_type,
    everything.status,
    everything.hotel_rate_currency,
    caller.is_owner,
    case when caller.is_owner then everything.settled_currency end;
$$;

comment on function public.settlement_summary(timestamptz, timestamptz, text) is
  'Request counts and hotel payouts, with the monthly volume bonus applied from the whole Asia/Tashkent calendar month each completion falls in. date_basis picks whether a completed request is placed by when it arrived or when it was completed; the bonus does not depend on it. A hotel account sees its own hotel and no turnover; the owner sees every hotel and every figure.';

revoke all on function public.settlement_summary(timestamptz, timestamptz, text) from public;
revoke all on function public.settlement_summary(timestamptz, timestamptz, text) from anon;
revoke all on function public.settlement_summary(timestamptz, timestamptz, text) from service_role;
grant execute on function public.settlement_summary(timestamptz, timestamptz, text) to authenticated;

drop function if exists public.owner_profit_summary(timestamptz, timestamptz);

create function public.owner_profit_summary(
  from_at timestamptz default null,
  to_at timestamptz default null,
  date_basis text default 'settled'
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
  where private.report_date_basis(date_basis) is not null
    and private.is_super_admin()
    and request.status = 'completed'
    and request.settled_at is not null
    and (from_at is null
         or case when date_basis = 'created' then request.created_at else request.settled_at end >= from_at)
    and (to_at is null
         or case when date_basis = 'created' then request.created_at else request.settled_at end < to_at)
  group by request.service_type, request.settled_currency;
$$;

comment on function public.owner_profit_summary(timestamptz, timestamptz, text) is
  'Revenue, supplier cost and margin per service and currency, for the owner alone. Returns no rows to anyone else. Margin counts only requests that have a cost recorded, so an unfinished month reads as incomplete rather than as pure profit.';

revoke all on function public.owner_profit_summary(timestamptz, timestamptz, text) from public;
revoke all on function public.owner_profit_summary(timestamptz, timestamptz, text) from anon;
revoke all on function public.owner_profit_summary(timestamptz, timestamptz, text) from service_role;
grant execute on function public.owner_profit_summary(timestamptz, timestamptz, text) to authenticated;

-- Requests per Tashkent day, for the overview's chart.
--
-- Places each row exactly as settlement_summary does, including leaving out a
-- completed request with no frozen rate, so the bars add up to the counters
-- printed beside them.
create function public.owner_request_timeline(
  from_at timestamptz default null,
  to_at timestamptz default null,
  date_basis text default 'created'
)
returns table (day date, status text, requests bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with placed as (
    select
      request.status,
      case
        when request.status = 'completed' and date_basis = 'settled' then request.settled_at
        else request.created_at
      end as placed_at
    from public.service_requests as request
    where private.is_super_admin()
      and (request.status <> 'completed'
           or (request.settled_at is not null and request.hotel_rate_minor is not null))
  )
  select
    (placed.placed_at at time zone 'Asia/Tashkent')::date,
    placed.status,
    count(*)::bigint
  from placed
  where private.report_date_basis(date_basis) is not null
    and (from_at is null or placed.placed_at >= from_at)
    and (to_at is null or placed.placed_at < to_at)
  group by 1, 2
  order by 1, 2;
$$;

comment on function public.owner_request_timeline(timestamptz, timestamptz, text) is
  'Requests per Asia/Tashkent day and status, placed the same way settlement_summary places them. Owner only: returns no rows to anyone else.';

revoke all on function public.owner_request_timeline(timestamptz, timestamptz, text) from public;
revoke all on function public.owner_request_timeline(timestamptz, timestamptz, text) from anon;
revoke all on function public.owner_request_timeline(timestamptz, timestamptz, text) from service_role;
grant execute on function public.owner_request_timeline(timestamptz, timestamptz, text) to authenticated;

-- What needs the owner's hand today, whatever period is on screen.
create function public.owner_attention()
returns table (overdue_open bigint, due_today bigint, telegram_failed bigint, missing_cost bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'Asia/Tashkent')::date as day
  ),
  -- A delivery that failed and then went through on a retry is not a problem,
  -- so only each request's latest attempt counts.
  latest_delivery as (
    select distinct on (delivery.request_id) delivery.request_id, delivery.status
    from public.telegram_deliveries as delivery
    order by delivery.request_id, delivery.attempt desc
  )
  select
    count(*) filter (where request.status in ('new', 'confirmed') and request.requested_date < today.day)::bigint,
    count(*) filter (where request.status in ('new', 'confirmed') and request.requested_date = today.day)::bigint,
    count(*) filter (where latest_delivery.status = 'failed')::bigint,
    count(*) filter (where request.status = 'completed' and request.cost_amount_minor is null)::bigint
  from public.service_requests as request
  cross join today
  left join latest_delivery on latest_delivery.request_id = request.id
  where private.is_super_admin();
$$;

comment on function public.owner_attention() is
  'Counts of what needs the owner today: open requests whose date has passed or is today, requests whose latest Telegram delivery failed, and completed requests with no supplier cost. Owner only: anyone else gets zeroes.';

revoke all on function public.owner_attention() from public;
revoke all on function public.owner_attention() from anon;
revoke all on function public.owner_attention() from service_role;
grant execute on function public.owner_attention() to authenticated;
