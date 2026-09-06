-- Settlement totals, counted in the database.
--
-- The admin list is capped at one page, so aggregating in the browser would
-- silently stop counting past that cap and quietly under-report what a hotel is
-- owed. This counts every matching row.
--
-- security invoker, deliberately: the rows it aggregates are exactly the rows
-- the caller may read under RLS. A hotel account therefore gets its own hotel
-- and the owner gets every hotel, from one function with no role branching and
-- nothing to keep in step with the policies.
--
-- Grouped by currency as well as by service, because som and dollars must never
-- be added together. Summing across currencies is the caller's mistake to avoid,
-- and this shape makes it visible rather than easy.

create or replace function public.settlement_summary(
  from_at timestamptz default null,
  to_at timestamptz default null
)
returns table (
  hotel_id uuid,
  service_type text,
  status text,
  settled_currency text,
  requests bigint,
  settled_amount_minor bigint,
  hotel_payout_minor bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    request.hotel_id,
    request.service_type,
    request.status,
    request.settled_currency,
    count(*)::bigint,
    coalesce(sum(request.settled_amount_minor), 0)::bigint,
    coalesce(sum(request.hotel_payout_minor), 0)::bigint
  from public.service_requests as request
  -- Half open, matching the admin list: a day filter includes its own day and
  -- stops at the next midnight, so a request is never counted twice.
  where (from_at is null or request.created_at >= from_at)
    and (to_at is null or request.created_at < to_at)
  group by request.hotel_id, request.service_type, request.status, request.settled_currency;
$$;

comment on function public.settlement_summary(timestamptz, timestamptz) is
  'Request and payout totals over what the caller may read: its own hotel for a hotel account, every hotel for the owner. Grouped by currency because som and dollars are not addable.';

revoke all on function public.settlement_summary(timestamptz, timestamptz) from public;
revoke all on function public.settlement_summary(timestamptz, timestamptz) from anon;
grant execute on function public.settlement_summary(timestamptz, timestamptz) to authenticated;
