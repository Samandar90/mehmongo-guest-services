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
- Files are CRLF on disk: use the Edit tool for multi-line changes and grep for the result; scripted `String.replace` edits have silently missed before.

## Binding documents

1. `docs/superpowers/specs/2026-08-31-mehmongo-request-admin-design.md`
2. `docs/superpowers/plans/2026-08-31-mehmongo-super-admin-implementation.md`
3. `docs/superpowers/plans/2026-08-31-mehmongo-a5-assets-implementation.md`
4. `docs/operations/supabase-pilot-runbook.md`
5. `docs/operations/a5-print-checklist.md`
6. The guest-catalogue brief delivered on the Desktop as `MehmonGo-Claude-Catalog-Final\CLAUDE-TASK.md`. Its `internal/PRICING-RU.md` is confidential: purchase prices, hotel payouts and the bonus formula must never reach the site, the bundle or GitHub.

The implementation plans use checkboxes but progress is tracked in the ignored ledgers under `.superpowers/sdd/`. Trust Git history and these ledgers rather than redoing completed tasks.

## Completed work (all reviewed, fix rounds applied)

- Guest intake plan Tasks 1–7: Supabase schema, RLS, migrations, room context, durable guest request submission, rate limiting, idempotency, Telegram delivery, protected manual retry, guest route `/r/<opaque-room-token>`.
- Super-admin plan Tasks 1–7: owner login and protected shell (`/admin/login`, sign-out hardening incl. re-entry after sign-out), hotel repository and create/edit form, hotel list/detail routes with scoped `.admin-*` styles, room parser and atomic `create_rooms_batch` RPC (pgTAP with anon/non-admin/super-admin role simulation), room editor with selection and guest-link copy, request repository/filters/Telegram retry screen, dashboard metrics. Date filters use Asia/Tashkent day boundaries (recorded ruling; deviates from the plan's UTC test literals).
- A5 asset plan Tasks 1–7: shared plaque template, QR, rasterizer, download, A5 PDF, ZIP, admin asset generator wired to the room editor selection, verifier script, print checklist. Browser canvas path verified in Chromium on a temporary page; Node generation verified with `npm run assets:generate` + `npm run assets:verify`.
- Schema additions since the handoff: `updated_at` trigger (`private.set_updated_at`), `create_rooms_batch`, `service_requests_created_idx`. pgTAP suites: 44 assertions across four files.
- `npm run typecheck` (`tsc -p tsconfig.typecheck.json`) is a clean gate; it extends the root config and excludes `supabase/functions`, which is Deno code verified by `functions:test`/`functions:lint`. Do not add that exclusion to the root `tsconfig.json`: Deno 2 reads it, and excluding the functions there strips their DOM lib types and breaks `deno test`.
- Public guest origin for admin links and QR codes comes from `VITE_SITE_URL` (`lib/site-url.ts`); keep it identical to `SITE_URL`.
- `components/guest-notice.tsx` renders the two dead-end guest screens: the site root and a room code that is no longer active. Both were bare unstyled sentences before.
- `scripts/create-admin.mjs` (`npm run admin:create`) creates, lists and removes super admins against `SUPABASE_URL` plus the secret key, or the local stack. It reads the password in raw mode without echoing and refuses to remove the last active administrator.
- Guest catalogue (Tashkent): `content/catalog.en.json` is the only source of guest copy and published starting prices. `scripts/build-catalog-data.mjs` regenerates `supabase/functions/_shared/catalog.data.ts`; `lib/catalog.test.ts` fails if they drift. A hotel sees the catalogue only when the owner sets the guest catalogue in the hotel form; otherwise the previous guest form stays. Requests store `offer_id` and a server-built, trigger-frozen `offer_snapshot`; Telegram and the admin show that snapshot, never today's price.

Important recent commits (newest first): `b11987a` asset generator hardening, `d60d408` typecheck gate, `2ce3d71` A5 verifier, `e1dbb2c` asset generator, `7e1645d` dashboard fix, `e74ec2f` requests screen fix, `f814886` room editor fix, `cee6af3` room batches fix, `a218cbf` hotel screens fix, `6c2e46b` updated_at trigger.

## Exact next work

The pilot is live (see "Production state"). Feature work in progress: hotel accounts and settlement analytics, Tasks 1 and 2 of six done — schema and RLS, then `public.settle_request`, `lib/admin/money.ts` and the settlement panel on the requests screen. All of it is local: the two migrations are deliberately not pushed to production until the feature is usable end to end.

Rulings made while building it, which later tasks must not undo:
- The minor unit is per currency. UZS has none in circulation, so the som IS the minor unit; USD is cents. `settlementCurrencies` in `lib/admin/money.ts` and the ceilings inside `settle_request` hold the same table and must move together.
- Never `Intl.NumberFormat` for money: CLDR has no zero-digit override for UZS and would add an invented hundredth to every som figure.
- The commission is frozen on the way into `completed` and kept while the request stays completed, so correcting a mistyped amount cannot repay the work at a rate agreed afterwards. Only a cancel-then-complete re-reads it.
- `service_requests` still has no UPDATE grant for `authenticated`, and must not get one: it would turn a hotel's forbidden edit into a silent zero-row success instead of a refusal.
- A catch-scoped `const` captured by a state-updater closure trips the react-compiler lint rule; read the value inside the updater instead.

Assumptions the owner has not ruled on: a zero settled amount is refused (a blank field reads as zero far more often than a service is genuinely free), and one request is capped at 1 000 000 000 сум or 100 000.00 USD purely as mistype protection.

Operational items still owner-side:

1. Domain decision before printing: the plaques encode `https://mehmongo.samandarup88.workers.dev/r/<token>`. A custom domain later means a rebuild with the new `SITE_URL`/`VITE_SITE_URL`, a redeploy, and reprinting every plaque, so decide first.
2. Print the A5 plaques from the live admin (hotel page → select rooms → materials) following `docs/operations/a5-print-checklist.md`.
3. Supabase dashboard, by hand: Authentication → Sign In / Providers → turn off "Allow new users to sign up" (the admin area is owner-only; sign-up only creates stray accounts). Not reachable through the connector.
4. Decide what happens to the older hosted demo site now that the new one is live.
5. Claude cannot hold an admin session (password entry is off limits and injecting a session was blocked), so any further UI checks in the admin are the owner's; the room toggle in the live room editor is the only admin control not yet exercised by hand.

On 2026-09-06 the owner lifted the earlier bans on hotel accounts and financial analytics; `docs/superpowers/plans/2026-09-06-mehmongo-hotel-accounts-analytics.md` is now binding and records their three decisions. Still out of scope: online payments, Telegram assignment buttons, and separate Telegram groups.

## Known limitations recorded in the ledgers

- `retry-telegram` answers 409 for an already-sent delivery too; the UI says the delivery is already running and asks to refresh.
- `service_requests.status` only allows `new`, so the dashboard's "Новые заявки" equals the total request count for now.
- The hotel detail page ships pdf-lib, jszip, qrcode and jsqr in its client chunk (~770 KB) by design of the browser-side generator.
- The reference plaque in `artifacts/` encodes a sample token and is a visual reference only.

## Local validation

```powershell
npm test -- --run
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
npm run functions:test
npm run functions:lint
npm run supabase:test
npx supabase db lint --local --schema public,private --fail-on error
npm run assets:generate -- <site-url> kamilovs "Kamilovs Hotel" 205:<token> 206:<token>
npm run assets:verify -- outputs/a5-verification/manifest.json
node scripts/build-catalog-data.mjs
node scripts/build-catalog-images.mjs
```

Local Edge Functions need the import map and a local secrets file:

```powershell
npx supabase functions serve --env-file supabase/.env.local --import-map deno.json
```

Local Supabase uses API port `56321` and database port `56322`. Do not reset Docker or delete volumes. If `supabase test db` is interrupted it can leave the `pgtap` extension in `public`, which makes `db lint` report pgTAP internals; `drop extension pgtap` on the local database fixes it. The local database has seeded Kamilovs rooms `205` and `206` with deterministic tokens `20000000-0000-4000-8000-000000000205/206`.

## Production state

Production Supabase project: `hraamyjvsnsgaezkolpl` (MehmonGo, eu-central-1, free tier), created on 2026-09-06 with the owner's blanket go-ahead. Schema and all three Edge Functions are deployed there through the Supabase connector (`room-context` and `submit-request` with `verify_jwt` off, `retry-telegram` on) and the migration history matches the seven local files. Edge secrets are set (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `REQUEST_HASH_SECRET`, `SITE_URL`) and the ignored `.env.production.secrets` / `.env.production.local` hold the working values, including the revealed project secret key. The guest site is live at `https://mehmongo.samandarup88.workers.dev` on Cloudflare Workers (owner's account, Worker `mehmongo`); redeploy with `npm run build -- --mode production` then `npx wrangler deploy --config dist/server/wrangler.json`. On 2026-09-06 the owner created the production super admin with `node scripts/create-admin.mjs --production`, then "Kamilovs Hotel" (slug `kamilovs-hotel`, catalogue `tashkent-v1`) with rooms 401–409 in the live admin, and generated the room 401 plaque, whose QR decodes to the live origin and the room's real token. The production smoke test passed twice over: the owner scanned the printed-preview QR on a phone and sent a real guide request `MG-4MBGIAUS` (Telegram message 13), and a clearly marked test request `MG-EVWDHJ4T` (airport sedan offer, snapshot from 30 USD, message 14) was created through the live `submit-request`, after which a replay with the same idempotency key returned the same reference with no second row. Both rows are deliberately left in place; nothing is deleted on production. Note for scripted checks from this Windows shell: non-ASCII characters in inline JSON (the `→` in catalogue choices, Cyrillic) reach curl mangled and the function answers `INVALID_REQUEST`; write the payload to a file with Node and send it with `--data-binary`. The other projects in that organization (Tishim and two inactive ones) are unrelated; do not modify them.

`codex/mehmongo-platform-mvp` is pushed to `origin` and tracks it. The remote repository is public and the two supplier vehicle photos are recorded as "All rights reserved"; the owner was told and chose to push anyway.

The existing public demo is still the older hosted site. Do not claim the new Supabase/Telegram/admin system is live until real deployment and end-to-end verification succeed.
