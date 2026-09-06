# MehmonGo hotel accounts and settlement analytics

Owner decisions, 2026-09-06. These supersede the earlier "no hotel staff accounts, no financial analytics" constraints, which the owner lifted explicitly.

- The **owner** records the settled amount and the outcome of a request in the super admin. A hotel never edits the numbers it is paid on.
- A hotel sees **its own payout and its own counters**: how many requests, which services, how much it is owed. Never purchase prices, never the platform margin, never another hotel.
- **One account per hotel**, created by the owner and handed to the hotel.

## Why the schema has to change first

Nothing about money exists today. `service_requests.status` accepts only `new`, and the only price on a request is `offer_snapshot`, the *starting* price shown to the guest, explicitly marked as unconfirmed. There is no record of what a service actually sold for, or whether it happened at all. Until a request can carry an outcome and a settled amount, there is no analytics to build.

## Money rules

- Amounts are **integer minor units** with an explicit currency. No floating point anywhere in the money path. Published prices are USD; the amount actually payable is agreed in UZS, so the currency is stored per request rather than assumed.
- The hotel's commission is **frozen onto the request** when it is settled, exactly as `offer_snapshot` freezes what the guest was shown. Renegotiating a rate must never rewrite what was already earned.
- The payout is a **generated stored column**, so the hotel's number and the owner's number are the same number by construction and cannot drift. It rounds to the nearest minor unit.
- `internal/PRICING-RU.md` stays out of the product. Purchase prices and the bonus formula never reach the database, the hotel cabinet or this repository.

## Tasks

1. **Done. Schema and access.** Request lifecycle (`new`, `confirmed`, `completed`, `cancelled`), `settled_amount_minor`, `settled_currency`, frozen `hotel_commission_bps`, generated `hotel_payout_minor`. `admin_users` gains `hotel_id` and the `hotel` role. RLS: a hotel reads only its own hotel, rooms and requests, and writes nothing. pgTAP covering anon, hotel and super-admin roles.
2. **Done. Settlement in the super admin.** On a request: set the outcome and, when completed, the amount and currency. The frozen commission is taken from the hotel at that moment.
3. **Done. Roles in the client.** `getAdminIdentity` returns the role and hotel id; the shell, navigation and every admin route respect it. A hotel account reaching an owner-only route is refused.
4. **Done. Hotel accounts in the super admin.** Create and disable a hotel login from the hotel page.
5. **Done. Hotel cabinet.** Own counters and own payout, by period and by service.
6. **Done. Owner analytics.** Totals, by service, by hotel, and what is owed to each hotel.

Tasks 1-4 are done and local-only. The owner chose the one-time password over an invite link: the password is generated in the Edge Function, returned once and never stored, and the screen says so. Its weakness is stated for the record — it travels through the owner's screen and whatever they paste it into, and nothing forces the hotel to change it.

 All six tasks are done, and all of it is local: the three migrations and the hotel-accounts function are deliberately not deployed until the owner has exercised the whole flow on the local stack.

The counting lives in the database on purpose. The request list is capped at one page, so folding it up in the browser would stop counting past the cap and under-report what a hotel is owed.

A route the navigation does not list is owner-only by default, so a section added later stays closed to a hotel account until someone opens it deliberately. A refused hotel account is told so and can sign out, rather than being redirected to the login page it has just come from.
