# MehmonGo handoff for Claude Code

## Product and language

MehmonGo is a hotel guest-services platform. Guests scan a room-specific QR code, use an English site without registration, and submit tours, transport, restaurant, or ticket requests. Requests are stored in Supabase and sent in Russian to one Telegram group. The super-admin interface is Russian and owner-only.

The user's messages should be answered in Russian. Guest-facing website copy stays English.

## Work in this checkout

- Repository: `C:\Users\user\Desktop\MehmonGo\.worktrees\mehmongo-platform-mvp`
- Branch: `codex/mehmongo-platform-mvp`
- Do not implement in the main checkout on `main`.
- Preserve existing commits and do not rewrite history.
- Never commit `.env.local`, Telegram credentials, Supabase service keys, or the ignored local smoke-owner fixture.
- Use the existing pinned dependencies and the existing Supabase/Docker setup.

## Binding documents

Read these before continuing:

1. `docs/superpowers/specs/2026-08-31-mehmongo-request-admin-design.md`
2. `docs/superpowers/plans/2026-08-31-mehmongo-super-admin-implementation.md`
3. `docs/superpowers/plans/2026-08-31-mehmongo-a5-assets-implementation.md`
4. `docs/operations/supabase-pilot-runbook.md`

The implementation plans use checkboxes but progress is tracked in the ignored ledgers under `.superpowers/sdd/`. Trust Git history and these ledgers rather than redoing completed tasks.

## Completed work

- Supabase schema, RLS, migrations, room context, durable guest request submission, rate limiting, idempotency, Telegram delivery, and protected manual retry.
- Guest route `/r/<opaque-room-token>` and real API-backed English request form.
- Guest intake Task 7 is reviewed and approved. Full frontend suite passed 23 tests at that point.
- Deployment runbook committed.
- Super-admin Task 1 implemented: verified owner login, active `super_admin` check, protected shell, login route, sign-out handling.
- Task 1 review found sign-out failure/race issues; commit `f0adabe` fixes them and reports 9 focused tests, lint, and build passing. Start by independently reviewing that fix before marking Task 1 complete.

Important recent commits:

- `f0adabe` — harden admin sign-out state
- `5cc6a7c` — protect the super-admin
- `92319c3` — submit real guest requests
- `19e965f` — prevent duplicate Telegram retry allocation

## Exact next work

1. Review diff `5cc6a7c..f0adabe` against the two findings in `.superpowers/sdd/2026-08-31-mehmongo-super-admin-implementation/task-1-review.md`. If clean, append Task 1 completion to that plan's `progress.md`.
2. Continue Super Admin Task 2 from `.superpowers/sdd/2026-08-31-mehmongo-super-admin-implementation/task-2-brief.md`: typed hotel repository plus create/edit form, using TDD and a separate review.
3. Complete Super Admin Tasks 3–7 in order.
4. Complete the A5 asset-generation plan after the room editor exists.
5. Run the full verification gate, then prepare the branch for the user's approval before merge/push/deploy.

Do not add financial analytics yet. This MVP only stores hotel commission as integer basis points. Do not add hotel staff accounts, online payments, Telegram assignment buttons, or separate Telegram groups.

## Local validation

```powershell
npm test -- --run
npm run lint
npm run build
npm run functions:test
npm run functions:lint
npm run supabase:test
npx supabase db lint --local --schema public,private --fail-on error
```

The root `tsc --noEmit` currently includes Deno Edge Function files and reports Deno-environment errors. Browser TypeScript errors were not observed outside `supabase/functions`. Fix the project configuration cleanly before using root `tsc` as a required gate; do not weaken application types.

Local Supabase uses API port `56321` and database port `56322`. Docker Desktop previously failed because stale local runtime socket directories were inaccessible; it was recovered without a factory reset. Do not reset Docker or delete volumes. A local browser smoke test confirmed `/admin/login`; a disposable ignored local owner can log in and reaches `/admin`, which remains 404 until the dashboard task creates that route.

## Production state

No new backend has been deployed. The connected Supabase projects previously visible were Tishim and two unrelated inactive projects; none was identified as MehmonGo. Do not modify those projects. Production requires the user to select or create a dedicated MehmonGo Supabase project and privately configure Telegram bot token, group chat ID, request-hash secret, owner account, and final site origin.

The existing public demo is still the older hosted site. Do not claim the new Supabase/Telegram/admin system is live until real deployment and end-to-end verification succeed.
