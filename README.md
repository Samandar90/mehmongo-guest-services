# MehmonGo Guest Services

Hotel concierge for guests. A guest scans the QR code in their room, opens an English page with no account and no app, and requests a tour, a private ride, a restaurant table or a ticket. Requests are stored in Supabase and sent in Russian to one Telegram group. The owner-only administration area is Russian.

## Live site

[mehmongo.samandarup88.workers.dev](https://mehmongo.samandarup88.workers.dev)

Each room has its own link, `/r/<room token>`, produced by the administration area together with the printable A5 plaque. The site root carries no room, so it only explains where to find a code.

## How a request travels

1. The guest opens their room link. `room-context` resolves the hotel, the room and the guest catalogue the hotel is attached to.
2. The guest picks an offer and fills the fields that offer needs. Published starting prices come from `content/catalog.en.json`; nothing about cost is ever taken from the browser.
3. `submit-request` validates the payload, builds the price snapshot on the server, stores the request atomically with its first delivery attempt, and posts the Russian message to Telegram.
4. The owner sees every request at `/admin/requests` and can retry a delivery that failed.

A request is not a booking: the team confirms availability and the full price with the guest before any payment.

## Local development

```bash
npm install
```

```bash
npm run dev
```

Edge Functions need the local stack and an ignored secrets file:

```bash
npx supabase functions serve --env-file supabase/.env.local --import-map deno.json
```

## Checks

```bash
npm test -- --run
```

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run supabase:test
```

## Deployment

The build emits a Cloudflare Worker. `docs/operations/supabase-pilot-runbook.md` carries the full procedure; `docs/operations/a5-print-checklist.md` covers the printed plaques.

```bash
npm run build -- --mode production
```

```bash
npx wrangler deploy --config dist/server/wrangler.json
```

## Administration

`node scripts/create-admin.mjs --production <email>` creates a super administrator, reading the password from the terminal without echoing it. `--list` shows who can sign in and `--remove` deletes an account, refusing to remove the last active one.
