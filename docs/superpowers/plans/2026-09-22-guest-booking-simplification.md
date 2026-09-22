# Simpler guest booking — plan (2026-09-22)

## Owner decision

On 2026-09-22 the owner chose two of four proposed changes:

- **Do:** (1) straight to the form, (2) a short form.
- **Declined for now — do not implement:** services on the first screen (the
  catalogue hero, trust list, steps and FAQ stay as they are) and remembering
  the guest's name/contact on the device (no localStorage of personal data).

Frontend only. Unchanged: server validation (`_shared/validation.ts`), the
`GuestRequestFields` payload, idempotency, `asap` semantics, English choice
values sent to the server, catalogue JSON, prices, printed QR links. Deploy is
the Worker alone, and only after the owner approves the result.

## Baseline (production, Kamilovs room 401, 375×812, measured 2026-09-22)

- Catalogue page 6451 px (7.9 screens); first offer card at 728 px; cards ~470 px.
- Card CTA opens a details dialog: 973 px of content in a 747 px dialog, so its
  CTA (same text as the card's) sits below the fold.
- Airport-sedan form: 1710 px (2.1 screens); first field at 484 px; submit at
  1698 px. Controls: direction `<select>` (2 options), asap/pick-time toggle,
  date, time, count `type=number`, flight, luggage, name, contact, note.
  No `autocomplete` on any input. Three `.form-legal` paragraphs before submit.

Re-measure the same numbers locally after the change and report before/after.

## Change 1 — straight to the form

- `components/guest-experience.tsx`: `onOpenOffer` goes to
  `{ step: 'offer-form', offer }`; drop the `details` step and the
  `OfferDetails` render. The form's back returns to the catalogue and scrolls
  the offer's card back into view (today the guest would land at the top of an
  8-screen page).
- `components/catalog/offer-details.tsx`: its content (description, caption,
  included, extras, confirm-before-payment, timing) becomes a collapsed
  `<details>` block inside the form, closed by default. Then delete the dialog
  and its CSS (`.offer-overlay`, `.offer-dialog*`, 16 matches in
  `app/globals.css`) once nothing uses them. Its only other user is
  `guest-experience.tsx`.
- Card CTAs and the ticket block keep their text (`offer.cta`); they now open
  the form directly.

## Change 2 — short form (`components/catalog/offer-request-form.tsx`)

- **Compact header:** back button, eyebrow, offer title as the `h1` (keep the
  focus-on-mount), one price line. Stop rendering `copy.title` ("Let's arrange
  the details") and `copy.intro`; leave the keys in the catalogue JSON.
- **Buttons instead of selects:** native radio inputs styled as segmented
  buttons in a `fieldset`/`legend`, for `airportDirections` (2),
  `mountainPreferences` (4) and `ticketModes` (3). Labels via `t.choices`,
  values stay the English strings. Validation messages unchanged.
- **Date chips:** Today / Tomorrow / Other date; the `type=date` input appears
  only for "Other date". Compute "today" in Asia/Tashkent (the same
  `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' })` as
  `tashkentToday()`), not the current UTC `todayIso()`. The server's past-date
  check (`validation.ts:200`) is UTC, and Tashkent is never behind UTC, so a
  Tashkent date is always accepted. For ride profiles, merge the existing
  asap toggle into the same "When" row: As soon as possible / Today / Tomorrow /
  Other date, with the time field shown only when not asap.
- **Travellers stepper:** `−` [input] `+`, min 1, max 50, keeping the labelled
  number input in the middle so typing still works. `draft.count` stays a string.
- **Autofill:** `guestName` gets `autoComplete="name"`; `contact` gets
  `autoComplete="tel"` but stays `type=text`, because it also takes
  `@username` or an email. `flight` gets `autoComplete="off"`.
- **One legal line:** a single `.form-legal` under the submit button made from
  the existing strings (`copy.payment` + `t.common.replyPromise`). Move
  `copy.privacy` to a hint under the contact field. No new legal copy.
- New UI strings (the details toggle, Today/Tomorrow/Other date, stepper
  aria-labels) go into `lib/i18n/messages/{en,ru,uz,zh}.ts`. Uzbek uses ʻ ʼ,
  never ASCII apostrophes; a test enforces this. Check `t.timing.*` for reusable
  keys first.
- Legacy `components/request-form.tsx` (hotels without a catalogue): only add
  the same `autoComplete` attributes.

## Tests to update

`components/guest-catalog.test.tsx` (dialog at :35 and :320;
`selectOptions('Direction' | 'Where would you like to go?')`; travellers
typing), `components/guest-catalog-ordering.test.tsx` (dialog at :35;
`selectOptions` at :49 and :66), and check `guest-experience.test.tsx` and
`guest-ordering.test.tsx`. Replace `selectOptions` with
`click(getByRole('radio', { name }))`. Add tests for: the Today/Tomorrow chips
producing Tashkent dates (fake timers around 02:00 Tashkent), the stepper bounds
1..50, and the details block being collapsed in the form.

## Verify

`npm test -- --run`, `npm run lint`, `npm run typecheck`, `npm run build`.
Visual check locally only, never against production:

1. Start Docker with `C:\Users\Comp X\Desktop\Запустить Docker.cmd`, then run
   `npx supabase start`.
2. Run `npx supabase functions serve --env-file supabase/.env.local --import-map deno.json`
   and `npm run dev`.
3. The seeded local hotel has no `guest_catalog_id`. Set `'tashkent-v1'` on
   the **local** database only, then open
   `http://localhost:3000/r/20000000-0000-4000-8000-000000000205` at 375×812.

Deploy after the owner's OK: `npm run build -- --mode production`, then
`npx wrangler deploy --config dist/server/wrangler.json`. This needs no
migration and no Edge Function deploy. Files are CRLF: use Edit for
multi-line changes.
