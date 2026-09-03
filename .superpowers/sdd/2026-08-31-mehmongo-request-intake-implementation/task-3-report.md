# Task 3 — Shared contracts and category validation

## Implementation

- Added shared request, result, and room-context contracts, plus reusable request-field maximums.
- Added exhaustive server-side payload validation: unknown-key, UUID, honeypot, UTC date, time, count, category-required-field, length, and trimming rules.
- Replaced duplicated guest types with shared contracts and removed query-string hotel lookup plus its fallback; the root page now reports an unavailable room link until Task 4 supplies `/r/<token>`.
- Updated room-label consumers and isolated Deno/Vitest test discovery so each runtime executes only its own tests.
- Added `deno.lock` to pin the JSR assertion dependency used by function tests.

## RED / GREEN evidence

- RED: `npm run functions:test -- supabase/functions/_shared/validation.test.ts` failed with `TS2307` because `validation.ts` did not exist.
- GREEN: the same command passed 7/7 after implementation.
- RED: `npm test -- --run components/guest-experience.test.tsx` failed because the UI rendered the removed `context.room` rather than `roomLabel`.
- GREEN: `npm test -- --run lib/guest-request.test.ts components/guest-experience.test.tsx` passed 8/8 after the type transition.

## Verification

- `npm run functions:test -- supabase/functions/_shared/validation.test.ts` — 7 passed.
- `npm test -- --run lib/guest-request.test.ts components/guest-experience.test.tsx` — 8 passed.
- `npm run lint` — passed.
- `npm test -- --run` — 4 files, 10 passed.
- `npm run functions:test` — 7 passed.
- `npm run build` — passed.
- `git diff --check` — passed.

## Files changed

- `.oxlintrc.json`, `vitest.config.ts`, `package.json`, `deno.lock`
- `supabase/functions/_shared/contracts.ts`, `supabase/functions/_shared/validation.ts`, `supabase/functions/_shared/validation.test.ts`
- `lib/guest-request.ts`, `lib/guest-request.test.ts`
- `app/page.tsx`, `components/guest-experience.tsx`, `components/guest-experience.test.tsx`, `components/request-success.tsx`

## Self-review and concerns

- Reviewed category coverage, strict parsing, trimming behavior, no fallback lookup, and test-runner boundaries; no unresolved defects found.
- The root route is intentionally unavailable until the approved QR route in Task 4 is implemented.

## Fix Round 1 — Deno lint coverage

- RED: `npx deno@2.9.6 lint supabase/functions/_shared/contracts.ts supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts` reported `no-import-prefix` and `no-unversioned-import` for `jsr:@std/assert`.
- Added root `deno.json` with `@std/assert` pinned to `jsr:@std/assert@1.0.19`, changed the test to use the bare alias, and added `functions:lint` for the complete Deno function tree.
- GREEN: `npm run functions:lint` passed after the alias change.
