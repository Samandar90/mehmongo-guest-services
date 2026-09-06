# Continuing MehmonGo on another computer

The project does not travel as a file. Everything but the secrets is in the
repository, and the secrets must not be sent through a chat.

## Do not send the project through Telegram

A copy of this folder contains `.env.local`, `supabase/.env.local`,
`.env.production.local` and `.env.production.secrets`. Between them they hold
the Telegram bot token, the Supabase project secret key and
`REQUEST_HASH_SECRET`. Anything pasted into a chat lives on that service's
servers and in every device that syncs the conversation, and a deleted message
does not undo that.

With the bot token, someone can post into the group as MehmonGo. With the
project secret key, someone can read and change the whole database, including
every guest's name and phone number, bypassing all access rules. Neither can be
made safe again by anything except rotating it.

So: clone the repository, and carry the four secret values in a password
manager instead.

## On the new computer

Install Node 24, Docker Desktop and Git, then:

```bash
git clone https://github.com/Samandar90/mehmongo-guest-services.git
```

```bash
cd mehmongo-guest-services && npm ci
```

`main` carries the whole project as of 2026-09-06, so the default clone is
enough; `codex/mehmongo-platform-mvp` points at the same commit.

## Recreate the four env files

None of these are in the repository, by design. `.env.example` shows the shape.

**`.env.local`** — local development against the local Supabase stack.
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SITE_URL`,
`VITE_SITE_URL`. The first two come from `npx supabase status` after the stack
starts; both site URLs are `http://localhost:3000`.

**`supabase/.env.local`** — local Edge Functions. `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `REQUEST_HASH_SECRET`. The token comes from @BotFather
(it can be shown again there), the chat id from `npm run telegram:check`, and
the hash secret can be any 32 random bytes locally — it only has to match
production if you compare rate limits.

**`.env.production.local`** — the live project. `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SITE_URL`,
`VITE_SITE_URL`. Every value is readable again from the Supabase dashboard
under Settings → API, or with
`npx supabase projects api-keys --project-ref hraamyjvsnsgaezkolpl --reveal -o json`.
The two site URLs are the live guest origin and must be identical.

**`.env.production.secrets`** — only needed to re-set the Edge secrets, which
are already set on the live project. `REQUEST_HASH_SECRET` is the one value
that cannot be read back from anywhere: keep it in a password manager. Losing
it costs nothing until you need to re-set the secrets, and rotating it resets
the ten-minute rate-limit window rather than breaking anything.

## Sign in again

Both are browser flows; nothing is copied between machines.

```bash
npx supabase login
```

```bash
npx wrangler login
```

## Start the local stack

```bash
npm run supabase:start
```

```bash
npx supabase db reset --local
```

```bash
node scripts/create-admin.mjs your-email@example.com
```

```bash
npm run dev
```

The reset loads the seeded Kamilovs hotel with rooms 205 and 206, and the
script creates a local administrator — local accounts do not come across from
another machine either.

## Check it works

```bash
npm test -- --run
```

```bash
npm run supabase:test
```

`CLAUDE.md` in the repository root carries the project handoff: what is built,
what was decided and why, and what is left. It names an absolute path from the
first machine, which will differ here; nothing else in it is machine-specific.
