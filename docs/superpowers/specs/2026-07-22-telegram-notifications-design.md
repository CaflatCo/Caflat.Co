# Telegram Notifications — Design (v2, no webhook)

## Purpose

Cafe owners currently only see key events (low stock, a new B2B order, the
day's close) by opening the app or the Remote Dashboard, and the platform
operator only sees new access/upgrade requests by checking Supabase or the
app directly. This adds push-style alerts to Telegram — free, no
per-message cost, no business verification — for both audiences.

## Revision note

The first version of this design (2026-07-21) used a shared bot with a
`/start <code>` deep-link webhook to auto-link a tenant's chat. That
webhook receiver never worked on this Supabase project: Supabase's
platform gateway requires an `apikey` on every request to any Edge
Function — enforced independently of the per-function "Verify JWT"
setting, and not satisfiable via a query parameter — so Telegram, which
cannot send custom headers, could never successfully deliver its webhook
(confirmed live: every invocation returned 401/403/`INVALID_CREDENTIALS`
regardless of JWT toggle state or key type). Rather than stand up a
second hosting platform just to receive one webhook, this revision drops
the webhook entirely: the owner gets their own numeric Telegram chat ID
from a free public bot and pastes it into Settings. Sending (the half
that already worked, since it's initiated by our own client code with a
proper auth header) is unchanged.

## Scope

- One shared bot, `@CaflatCOREAlertsBot`, serves every tenant **and** the
  platform operator.
- Two distinct recipient kinds:
  - **Per-tenant** (the cafe owner's own chat): low stock, new B2B order,
    Daily Close summary. Three toggles in that tenant's Settings.
  - **Platform admin** (you, the Caflat.CORE operator, one fixed chat):
    new access request (landing page, pre-tenant) and new upgrade request
    (an existing tenant asking you to process an upgrade). Not tenant
    events at all — no per-tenant toggle.
- Delivery goes through one Supabase Edge Function (`telegram-notify`,
  called by our own client code) so the bot token never reaches a
  browser or till.
- Linking a tenant's chat is a **manual paste**, not a webhook: the owner
  gets their chat ID from a third-party bot (`@userinfobot` or similar)
  and enters it in Settings.

Out of scope for this iteration: group/channel delivery, multiple chats
per tenant, WhatsApp/SMS/other channels, a bring-your-own-bot option,
letting a tenant see or control the admin-notification path, any
Telegram-initiated (webhook) traffic.

## Architecture

```
Cafe browser/till                          Supabase Edge Function      Telegram
──────────────────                          ─────────────────────      ────────
Settings: paste chat ID + Connect
  → scope:'test' send FIRST ──POST──▶  telegram-notify  ──sendMessage──▶ owner's
  → only on success: UPSERT               (raw chat_id, no                 chat
    telegram_links (client REST call)       DB lookup)

notifyTelegram(event, msg)  ──POST──▶  telegram-notify  ──sendMessage──▶ owner's
  (3 tenant call sites)                  tenant: look up chat_id             chat
                                           from telegram_links
notifyTelegramAdmin(event, msg)          admin: use fixed
  (2 admin call sites)                     TELEGRAM_ADMIN_CHAT_ID       ──▶ your
                                           secret (no DB lookup)            chat
```

One Edge Function, one direction of traffic (our servers/clients calling
out to Telegram), zero inbound webhooks. The bot token
(`TELEGRAM_BOT_TOKEN`) and `TELEGRAM_ADMIN_CHAT_ID` live only as Edge
Function secrets.

## Data model (new migration, `014_telegram_notifications.sql`)

```sql
CREATE TABLE public.telegram_links (
  id         bigserial   PRIMARY KEY,
  tenant_id  uuid        NOT NULL,
  chat_id    bigint      NOT NULL,
  revoked    boolean     NOT NULL DEFAULT false,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)                -- one active link per tenant
);
```

RLS: same anon-with-app-level-tenant-isolation model as `remote_tokens`
(migration 011) — `FOR ALL USING (true) WITH CHECK (true)`, since tenant
isolation is enforced by the app/Edge Function, not Postgres roles. No
`telegram_link_codes` table this time — there's no code to look up.

`telegramEvents` (per-event on/off, tenant events only) stays
client-side on `APP_STATE.settings`, same as every other feature toggle,
synced through the existing settings persistence path.

The admin path needs no database row: `TELEGRAM_ADMIN_CHAT_ID` is a
plain Edge Function secret you set once, obtained the same way a tenant
gets theirs — message a chat-ID bot yourself and copy the number.

## Linking flow

1. Settings → "Telegram Alerts" card, disconnected state: instructions
   ("1. Message **@userinfobot** on Telegram — it replies instantly with
   your numeric chat ID. 2. Paste it below.") plus a text input and a
   **Connect** button.
2. On submit: client validates the input is numeric, then calls
   `telegram-notify` with `{scope: 'test', chat_id: <pasted value>,
   message: "✅ Caflat.CORE alerts connected!"}` — a raw send with no DB
   involved, verifying the ID *before* anything is written.
3. If Telegram rejects it (bad ID, typo, chat doesn't exist), Settings
   shows an inline error ("Couldn't reach that chat — double check the
   ID and try again") and nothing is saved. If it succeeds, the client
   upserts `{tenant_id, chat_id, revoked: false}` into `telegram_links`
   (`on_conflict=tenant_id`), and Settings flips to the connected state
   showing three checkboxes (Low stock / New B2B order / Daily Close
   summary), all defaulting **on**.
4. **Disconnect** sets `revoked = true` on the tenant's `telegram_links`
   row (soft-revoke, mirrors `remote_tokens`).

## Event triggers

Unchanged from the original design — two small client helpers gate and
send:

```js
// Tenant events: low stock, new B2B order, Daily Close
async function notifyTelegram(eventType, message) {
  if (!APP_STATE.settings?.telegramEvents?.[eventType]) return;
  if (!APP_STATE.settings?.telegramLinked) return;
  try {
    await fetch(`${CAFLAT_SB_FUNCTIONS_URL}/telegram-notify`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
      },
      body: JSON.stringify({ scope: 'tenant', tenant_id: getTenantId(), eventType, message }),
    });
  } catch (e) { /* silent — never blocks the underlying action */ }
}

// Admin events: new access request, new upgrade request
async function notifyTelegramAdmin(eventType, message) {
  try {
    await fetch(`${CAFLAT_SB_FUNCTIONS_URL}/telegram-notify`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
      },
      body: JSON.stringify({ scope: 'admin', eventType, message }),
    });
  } catch (e) { /* silent */ }
}
```

(The `apikey`/`Authorization` headers use the project's existing anon
key — proven to work for this Edge Function in the first build attempt;
this was never the broken half.)

Call sites (all existing code, one line added at each):

| Event | Recipient | File / hook |
|---|---|---|
| Low stock | Tenant | `js/storage.js`, hooked off `persistState()` with its own throttle (see Errors below) — diff new low-stock item list against the last-sent list; call `notifyTelegram('lowStock', ...)` only when new items appear, batched into one message |
| New B2B order | Tenant | `js/supply.js`, `checkPortalInbox()` — right after a portal order lands as a new DRAFTED supply order |
| Daily Close summary | Tenant | `js/endofday.js`, `closeTheDay()` — after the close record is written, with revenue/variance/drawer count |
| New access request | Admin | `landing/js/main.js`, right after the `access_requests` insert succeeds |
| New upgrade request | Admin | `js/license.js`, right after the `upgrade_requests` insert succeeds |

`telegram-notify` branches on `scope`: `tenant` looks up `chat_id` from
`telegram_links` (must not be `revoked`); `admin` uses the fixed
`TELEGRAM_ADMIN_CHAT_ID` secret directly; `test` sends to the `chat_id`
given in the request body with no DB lookup at all (used only by the
Settings connect flow, to verify a pasted ID before it's ever stored).
All three then call Telegram's `sendMessage`. On a `403` for a `tenant`
send specifically (bot blocked/removed), it marks that `telegram_links`
row `revoked = true` server-side so Settings reflects "Disconnected" on
next load instead of retrying forever — `test` sends have no row to
revoke, they just report success/failure straight back to Settings.

## Errors avoided from the first build (carried forward, still true)

- **Tier gating:** the low-stock check must not be nested inside
  `pushKpiSnapshot()`, which early-returns for non-PRO tenants via
  `_cloudEligible()`. It gets its own throttled hook off `persistState()`
  (a `scheduleLowStockNotifyCheck()` sibling call, independent of cloud
  eligibility) so it works on every tier.
- **Auth headers on `telegram-notify`:** both client helpers must send
  the anon key via `apikey`/`Authorization` headers — omitting them hits
  Supabase's mandatory gateway credential check, exactly like the old
  webhook did.

## Error handling

- All `notifyTelegram`/`notifyTelegramAdmin` failures are swallowed
  client-side, same as `pushKpiSnapshot` today — logged, never surfaced
  to the cashier, never blocks the sale/close/order/request that
  triggered it.
- The one exception is the **initial connect test-send** in Settings,
  which is allowed to surface a failure inline (that's the whole point —
  catching a bad chat ID immediately, not three days later when nothing
  ever arrives).

## Testing / verification plan

1. `telegram-notify` in isolation: curl for linked/unlinked/revoked
   tenants and for admin scope, confirming status codes and DB state
   (unchanged from the original plan — this function already worked).
2. Manual linking: paste an obviously-wrong ID first, confirm the inline
   error path and that no `telegram_links` row gets written. Then get a
   real chat ID from `@userinfobot`, paste it in, confirm the test
   message arrives, Settings flips to connected, and a row now exists.
3. Each of the five triggers, live: real low-stock crossing (on a
   **FREE**-tier install, to prove it isn't tier-gated), real portal
   order, real day close, real access-request submission, real upgrade
   request — confirm one correctly-worded message per event in the right
   chat, and that toggling a tenant event off in Settings suppresses
   only that one.
4. Failure paths: revoke mid-session and confirm the underlying action
   still completes normally; simulate a `403` from Telegram and confirm
   the link gets marked revoked.
5. Regression: full existing Playwright suite plus a visual pass on the
   new Settings card.

## Files touched

- `supabase/migrations/014_telegram_notifications.sql` — new table
  (`telegram_links` only — no codes table this time)
- `supabase/functions/telegram-notify/index.ts` — the one Edge Function
  (branches tenant vs admin scope) — no `telegram-link` function at all
- `js/settings.js` / `index.html` — new "Telegram Alerts" card
  (paste-chat-ID connect flow, disconnect, three tenant-event toggles)
- `js/storage.js` — low-stock diff + `notifyTelegram()` call, hooked
  independently of the cloud/PRO-gated KPI tick; connect/disconnect
  logic for the Settings card
- `js/supply.js` — one `notifyTelegram()` call in `checkPortalInbox()`
- `js/endofday.js` — one `notifyTelegram()` call in `closeTheDay()`
- `landing/js/main.js` — one `notifyTelegramAdmin()`-equivalent inline
  call after the access-request insert succeeds
- `js/license.js` — one `notifyTelegramAdmin()` call after the
  upgrade-request insert succeeds
