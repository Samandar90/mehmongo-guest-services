# MehmonGo handoff for Claude Code

## Product and language

MehmonGo is a hotel guest-services platform. Guests scan a room-specific QR code, use the site without registration in English, Russian, Uzbek (Latin) or Chinese (Simplified), and submit tours, transport, restaurant, or ticket requests. Requests are stored in Supabase and sent in Russian to one Telegram group. The super-admin interface is Russian and owner-only.

The user's messages should be answered in Russian. Guest-facing copy exists in all four languages (added 2026-09-09; see "Guest languages" below); a new guest string is added to every language or it does not compile.

## Work in this checkout

- Repository on the owner's second machine (2026-09-07 onward): `C:\Users\Comp X\Desktop\mehmongo-guest-services`, branch `main`. The worktree layout below belonged to the first machine and no longer exists.
- Docker Desktop on that machine crashes on startup because the user profile path contains a space: it writes a socket at `unix://C:\Users\Comp X\AppData\Local\Docker\run\dockerInference`, then cannot remove it. Launch it with `Запустить Docker.cmd` on the Desktop, which clears the broken sockets and passes the 8.3 short path.
- Historical, for the first machine: branch `codex/mehmongo-platform-mvp`, do not implement in the main checkout on `main`.
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
6. `docs/operations/second-machine-setup.md` — continuing the project on another computer without moving secrets through a chat
7. The guest-catalogue brief delivered on the Desktop as `MehmonGo-Claude-Catalog-Final\CLAUDE-TASK.md`. Its `internal/PRICING-RU.md` is confidential: purchase prices, hotel payouts and the bonus formula must never reach the site, the bundle or GitHub.

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

The pilot is live (see "Production state"). Hotel accounts and settlement analytics are complete, all six tasks: schema and RLS, `public.settle_request` with `lib/admin/money.ts` and the settlement panel, roles in the admin shell, the `hotel-accounts` Edge Function with its screen on the hotel page, the hotel cabinet at `/admin/hotel`, and the owner's totals on `/admin`. Deployed to production on 2026-09-06 through the Supabase connector (the CLI is not linked; linking needs the database password, which only the owner has). The three migrations applied with the existing data intact — 3 requests, 1 hotel, 9 rooms, 1 owner — the `hotel-accounts` function is live with `verify_jwt`, and the Worker was rebuilt and redeployed. Verified live: every admin route answers, the guest page still resolves its hotel, and both new entry points refuse an anonymous caller (`settle_request` at the grant level, `hotel-accounts` with 401).

Rulings made while building it, which later tasks must not undo:
- The minor unit is per currency. UZS has none in circulation, so the som IS the minor unit; USD is cents. `settlementCurrencies` in `lib/admin/money.ts` and the ceilings inside `settle_request` hold the same table and must move together.
- Never `Intl.NumberFormat` for money: CLDR has no zero-digit override for UZS and would add an invented hundredth to every som figure.
- **Superseded on 2026-09-07 by the fixed-rate model below.** The percentage commission was frozen on the way into `completed`, and a cancel-then-complete re-read it. The rate is now frozen once and never re-read, because the completion date decides which month is paid.
- `service_requests` still has no UPDATE grant for `authenticated`, and must not get one: it would turn a hotel's forbidden edit into a silent zero-row success instead of a refusal.
- A catch-scoped `const` captured by a state-updater closure trips the react-compiler lint rule; read the value inside the updater instead. A `useCallback` that sets state, called from an effect body, trips its cascading-render rule: put the loader inside the effect and reload with a counter.
- **Superseded on 2026-09-07.** `public.settlement_summary` was `security invoker` so one function could serve both roles. It is now `security definer`: the hotel has no policy on `service_requests` any more, so an invoker function would return it nothing, and the column list — which a row policy cannot express — is enforced inside. Counting still stays in the database, for the original reason: the request list is capped at one page, and folding it up in the browser would under-report what a hotel is owed.
- Money is grouped by currency everywhere and never totalled across currencies.

Two advisor warnings on production are known and expected. `settle_request` is flagged as a `security definer` function callable by `authenticated`: that is the design — the grant is what lets the owner call it at all, and the function's own `is_super_admin()` check is the barrier. Leaked-password protection is off; enabling it in Authentication → Passwords is a one-click improvement now that hotel accounts exist.

Assumptions the owner has not ruled on: a zero settled amount is refused (a blank field reads as zero far more often than a service is genuinely free), and one request is capped at 1 000 000 000 сум or 100 000.00 USD purely as mistype protection.

Operational items still owner-side:

1. Domain decision before printing: the plaques encode `https://mehmongo.samandarup88.workers.dev/r/<token>`. A custom domain later means a rebuild with the new `SITE_URL`/`VITE_SITE_URL`, a redeploy, and reprinting every plaque, so decide first.
2. Print the A5 plaques from the live admin (hotel page → select rooms → materials) following `docs/operations/a5-print-checklist.md`.
3. Supabase dashboard, by hand: Authentication → Sign In / Providers → turn off "Allow new users to sign up" (the admin area is owner-only; sign-up only creates stray accounts). Not reachable through the connector.
4. Decide what happens to the older hosted demo site now that the new one is live.
5. Claude cannot hold an admin session (password entry is off limits and injecting a session was blocked), so any further UI checks in the admin are the owner's; the room toggle in the live room editor is the only admin control not yet exercised by hand.

On 2026-09-06 the owner lifted the earlier bans on hotel accounts and financial analytics; `docs/superpowers/plans/2026-09-06-mehmongo-hotel-accounts-analytics.md` is now binding and records their three decisions. Still out of scope: online payments, Telegram assignment buttons, and separate Telegram groups.

## Hotel payouts: fixed rates, decided 2026-09-07

The percentage of turnover is gone. Every hotel is on the same terms: a fixed
sum per **completed** request, plus a monthly volume step.

| service_type | rate | volume step applies | counts toward the step |
| --- | --- | --- | --- |
| `transport` | $2.00 | yes | yes |
| `tours` | $8.00 | yes | yes |
| `tickets` | $2.00 | **no** | yes |
| `restaurants` | not paid | no | yes |

Steps by completed requests in an Asia/Tashkent calendar month: 1–14 none,
15–39 +20%, 40+ +40%. The step multiplies **every** request of that month, not
only those past the threshold. Tickets are flat because the service fee on a
ticket is about $2.40, and +40% would pay out more than the ticket earns.

Why fixed rather than a percentage: the hotel can verify its own payout by
counting requests in its cabinet, without ever seeing — or having to trust —
our turnover. That is the argument the partner site is built on
(`https://samandar90.github.io/mehmongo-partners/`, repository
`Samandar90/mehmongo-partners`).

Rulings this created, which later work must not undo:

- **A hotel must never see `settled_amount_minor`.** Staff still record what
  every completed request sold for; it is the owner's figure alone. The hotel's
  row policy on `service_requests` was dropped for this: a row policy cannot
  hide a column, and PostgREST filters on a column a role may select even when
  it is not requested, so `?select=id&settled_amount_minor=gt.X` plus a binary
  search would read it back. Hotels read `public.hotel_requests` and
  `public.settlement_summary`, both of which name their columns.
- Only the **base** rate is frozen onto a request, at first completion. The
  monthly step cannot be frozen per row: it is a property of the whole month.
- `settled_at` is set on first completion and never moved. A cancel and a later
  re-completion must not slide a request into a month that is already paid, and
  must not re-read the rate card.
- The month boundary is `private.payout_month()`, one shared definition, so a
  completion just after Tashkent midnight lands in the right month.
- Payout currency and settlement currency are different things: the hotel is
  paid in dollars while a sale is usually settled in som. They are never put on
  one row and never added.
- `hotels.commission_bps` and `service_requests.hotel_commission_bps` still
  exist and are still written, but nothing reads them for money any more. They
  are dropped in a later migration, once no screen mentions them.

## Guest languages, added 2026-09-09

The guest site speaks `en`, `ru`, `uz` (Latin) and `zh` (Simplified). The
header pill is `components/language-menu.tsx`; the choice is a cookie
(`mg_lang`, one year) and the server renders the first paint in it:
`lib/i18n/server.ts` resolves `?lang=` → cookie → `en`, so `?lang=zh` on a
room link is a way to demo a language.

**A scanned plaque always opens in English** (owner's decision, 2026-09-12).
`Accept-Language` was consulted until then and is deliberately not any more:
a hotel wants one predictable first screen, and a phone's language is a poor
guess at the language its owner reads. Restoring it means restoring
`localeFromAcceptLanguage` in `lib/i18n/locale.ts` — it is in the history of
that file, removed rather than left dead. Changing this changes no printed
plaque: the QR encodes `<origin>/r/<token>` and nothing about language.

- Interface strings: `lib/i18n/messages/{en,ru,uz,zh}.ts`, typed against the
  English object. Components read them through `useI18n()`
  (`lib/i18n/context.tsx`); with no provider they are English, which is why
  the older tests still pass unchanged.
- Catalogue: `content/catalog.{ru,uz,zh}.json` mirror `catalog.en.json` file
  for file. `scripts/build-catalog-data.mjs` now also writes
  `lib/i18n/catalog-translations.ts`; `lib/i18n/catalog.test.ts` fails on
  drift and holds ids, prices, profiles and list lengths equal to English.
  `localiseCatalog` overlays text only: prices, ids, capacity and image paths
  always come from the English catalogue, and the Edge Functions still read
  English alone.
- Fixed choices (`Airport → hotel`, `Chimgan`, `Train`…) are shown through
  `messages.<locale>.choices` but submitted as the English value the server
  validates and the team reads.
- `service_requests.guest_locale` (migration `20260909100000_guest_locale.sql`,
  check constraint mirroring `GUEST_LOCALES` in `_shared/contracts.ts`) stores
  the language the guest was reading; `submit_guest_request` gained
  `p_guest_locale text default 'en'` (old signature dropped, grants restated).
  Telegram prints `🌐 Язык гостя: …` on every request and the admin shows it in
  the guest cell and the details. Deploy order when this changes again:
  migration, then `submit-request`/`retry-telegram`, then the Worker — the old
  validator rejects an unknown payload key.
- Uzbek uses the typographic apostrophes (ʻ U+02BB, ʼ U+02BC), never ASCII;
  a test enforces it. Chinese headings get `word-break: keep-all` and no
  negative tracking via `:lang(zh)` rules at the end of `globals.css`; the
  page root carries `lang` so those rules and the CJK font selection apply
  from the first paint. Geist is loaded with the `cyrillic` subset.

## Ordering from the room, added 2026-09-10

Four conveniences for a guest with a phone in a hotel room:

- **As soon as possible.** Rides (offer profiles `airport`, `airport_arrival`,
  `intercity`, and the legacy `transport` form) carry a two-button choice
  above the date and time. When chosen, the client sends `asap: true` with an
  empty date and time; the server (`_shared/validation.ts`) accepts it only
  for those rides, refuses a time next to it, and dates the request itself
  with `tashkentToday()` — a phone still on home time is a day out at night.
  Column `service_requests.asap` (migration `20260910100000_asap_requests.sql`)
  with check `not asap or requested_time is null`; `submit_guest_request`
  gained `p_asap boolean default false` (19 parameters now; the old signature
  is dropped and grants restated). Telegram prints `⚡ срочно` in the title and
  `🕒 Время: ⚡ как можно скорее`; the admin shows the same in the details.
- **Pickup starts from the hotel.** `room-context` now returns `hotelAddress`
  (`hotels.address`, may be empty); `hotelPickupLine()` in
  `lib/guest-request.ts` makes "Hotel, address" (or the name alone) and the
  `city`, `intercity` and legacy transport pickups start with it, editable,
  with a hint underneath. Tickets do not: a journey starts wherever it starts.
- **Write to us.** `content/contact.json` holds the WhatsApp number (digits
  only), an optional Telegram username (button hidden while empty), and the
  reply promise (`replyMinutes`, `hoursFrom`, `hoursTo`) printed under every
  form and on the confirmation. The confirmation offers wa.me / t.me links
  whose prefilled text is the guest's own first message in their language,
  with the reference, hotel and room (`success.contactMessage`).
- **Save this page.** `components/save-page-button.tsx`: the share sheet
  with the room link plus `?lang=`, falling back to the clipboard. In the
  footer of every guest screen and, larger, on the confirmation.

Deploy order when these change again: migration, then the Edge Functions
(`submit-request`, `retry-telegram`, `room-context`), then the Worker.

## The admin as an installed app, added 2026-09-12

`/admin` installs to a phone home screen or a desktop dock. The pieces:
`public/admin.webmanifest` (scope and `start_url` `/admin`, standalone, navy
theme), the icons built by `npm run icons` into `public/` from the brand mark,
`public/admin-sw.js`, and `public/admin-offline.html`. The manifest is linked
from `app/admin/layout.tsx` metadata alone — never the root layout, or a guest
scanning a plaque would be offered "install MehmonGo admin".

- The service worker **caches nothing but the offline notice**. Not the
  bundle, not one Supabase response. This screen shows money: a figure from
  yesterday's cache is worse than no figure, and a stale bundle after a deploy
  worse still. Non-navigation requests are not intercepted at all. Bump
  `VERSION` in the worker to drop the old cache.
- The offline page is cached as `/admin-offline`, without the extension:
  Cloudflare serves the asset at the clean path and answers
  `/admin-offline.html` with a 307 to it.
- Scope is `/admin`, not `/admin/` — the dashboard itself is exactly `/admin`,
  which a trailing slash would leave uncontrolled.
- `lib/admin/install-script.ts` is inlined in the admin layout and runs while
  the HTML parses. It registers the worker and catches `beforeinstallprompt`,
  because Chrome fires that once and early, and `InstallApp` — which lives in
  the navigation, behind the identity check — mounts far too late to hear it.
  It is written as a real function and serialised with `toString()`, so it is
  type-checked and testable rather than a string nobody can verify; that
  survives minification because it only touches globals and literals.
- `components/admin/install-app.tsx` reads both the platform and the caught
  prompt through `useSyncExternalStore`, not an effect: setting state in an
  effect body trips the react-compiler rule this project has hit before.
  Safari gets instructions instead of a button, since iOS has no prompt API.

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
