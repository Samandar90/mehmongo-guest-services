-- Atomic room creation for the super admin: every label in one insert, so a
-- single conflicting (hotel_id, label) rolls back the whole batch.
-- security invoker: RLS on public.rooms still applies to the caller; the
-- explicit is_super_admin() check only turns a silent policy denial into a
-- clear 42501 for the admin UI.

create function public.create_rooms_batch(target_hotel_id uuid, room_labels text[])
returns setof public.rooms
language plpgsql
security invoker
set search_path = ''
as $$
declare
  label_count integer;
begin
  if not private.is_super_admin() then
    raise exception 'only an active super admin can create rooms'
      using errcode = '42501';
  end if;

  label_count := coalesce(cardinality(room_labels), 0);
  if label_count = 0 then
    raise exception 'room_labels must contain at least one label'
      using errcode = '22023';
  end if;
  if label_count > 300 then
    raise exception 'room_labels may contain at most 300 labels'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(room_labels) as raw(label)
    where raw.label is null
       or char_length(btrim(raw.label)) not between 1 and 40
  ) then
    raise exception 'each room label must be 1 to 40 characters after trimming'
      using errcode = '22023';
  end if;

  if (
    select count(*) - count(distinct lower(btrim(raw.label)))
    from unnest(room_labels) as raw(label)
  ) > 0 then
    raise exception 'room_labels contains duplicate labels'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.hotels where id = target_hotel_id) then
    raise exception 'hotel % does not exist', target_hotel_id
      using errcode = 'P0002';
  end if;

  return query
    insert into public.rooms (hotel_id, label)
    select target_hotel_id, btrim(raw.label)
    from unnest(room_labels) as raw(label)
    returning *;
end;
$$;

revoke all on function public.create_rooms_batch(uuid, text[]) from public;
revoke all on function public.create_rooms_batch(uuid, text[]) from anon;
grant execute on function public.create_rooms_batch(uuid, text[]) to authenticated, service_role;
