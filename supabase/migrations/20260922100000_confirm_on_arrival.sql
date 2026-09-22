-- A guest request is confirmed the moment it arrives (owner's decision,
-- 2026-09-22): the team no longer presses «Подтвердить» on every one. The
-- outcome stays editable in the admin, back to «Новая» too, just in case.
--
-- submit_guest_request names no status and takes this default, so the
-- default is the one place a request's first status is decided. The
-- settlement check is satisfied as before: a status other than completed
-- carries no settled amount.
alter table public.service_requests alter column status set default 'confirmed';
