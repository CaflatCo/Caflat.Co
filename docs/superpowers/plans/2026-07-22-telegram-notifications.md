# Telegram Notifications Implementation Plan (v2, no webhook)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push five key events to Telegram — three per-tenant (low stock,
new B2B order, Daily Close) to the cafe owner's own chat, and two
platform-admin (new access request, new upgrade request) to a single
fixed operator chat — via a shared bot and one Supabase Edge Function.
Linking a tenant's chat is a manual paste of a chat ID (verified with a
live test-send before it's stored), not a webhook — the original webhook
design was proven unworkable on this Supabase project (see the v1 spec's
revision note and `docs/superpowers/specs/2026-07-22-telegram-notifications-design.md`).

**Architecture:** One bot (`@CaflatCOREAlertsBot`). One Edge Function,
`telegram-notify`, handles all outbound sends, branching on
`scope: 'tenant'` (looks up `chat_id` from `telegram_links`),
`scope: 'admin'` (fixed `TELEGRAM_ADMIN_CHAT_ID` secret), or
`scope: 'test'` (sends to a raw `chat_id` from the request body, no DB
involved — used only to verify a pasted ID before saving it). No inbound
traffic from Telegram at all.

**Tech Stack:** Deno (Supabase Edge Functions), Postgres/PostgREST
(existing Supabase project), vanilla JS (existing app, no build step),
Telegram Bot API.

## Global Constraints

- No new build tooling, bundler, or npm dependency — this project is
  hand-authored HTML/CSS/JS with no build step; the one Edge Function is
  the only place Deno/TypeScript is used, inherent to Supabase Edge
  Functions, not a new tooling choice.
- Match existing patterns exactly: fetch-based Supabase REST calls with
  `apikey`/`Authorization: Bearer` headers (see `js/license.js`'s
  `_sbFetch`), inline-styled settings cards using `var(--white)`,
  `var(--border)`, `var(--radius-lg)`, `var(--gray-500)`, `var(--black)`
  (see `renderRemoteDashboardSection` in `js/storage.js`), and
  `showNotification(msg, type)` for user feedback.
- This project applies Supabase changes manually through the Supabase
  Dashboard (SQL editor for migrations, the Edge Functions UI for
  functions) — there is no Supabase CLI project scaffold in this repo,
  and this plan does not introduce one.
- **Every call to `telegram-notify` MUST include `apikey` and
  `Authorization: Bearer <anon key>` headers.** Supabase's gateway on
  this project rejects any Edge Function request without them — this
  was the root cause that broke the original webhook design, and it
  applies equally to these outbound calls.
- **The low-stock check must never be nested inside `pushKpiSnapshot()`**
  (which early-returns for non-PRO tenants via `_cloudEligible()`) — it
  needs its own throttle, independent of tier, or the "free" alert
  silently becomes a paid-tier-only feature.
- A failed Telegram notification must never block the underlying action
  (a sale, a close-day, an order import, a request submission). Every
  client-side call site swallows errors silently, exactly like the
  existing `pushKpiSnapshot()` does today.

---

### Task 1: Migration — `telegram_links` table

**Files:**
- Create: `supabase/migrations/014_telegram_notifications.sql`

**Interfaces:**
- Produces: table `public.telegram_links (id, tenant_id, chat_id,
  revoked, linked_at)`, unique on `tenant_id`.

- [ ] **Step 1: Write the migration file**

```sql
-- ═══════════════════════════════════════════════════════
-- 014 — Telegram Notifications
--   telegram_links: one active chat per tenant, linked by the owner
--   pasting a chat ID they got from a third-party bot (no webhook).
--   Admin (platform operator) notifications use a fixed chat id stored
--   only as an Edge Function secret — no table for that path.
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.telegram_links (
  id         bigserial   PRIMARY KEY,
  tenant_id  uuid        NOT NULL,
  chat_id    bigint      NOT NULL,
  revoked    boolean     NOT NULL DEFAULT false,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE INDEX IF NOT EXISTS telegram_links_tenant
  ON public.telegram_links (tenant_id);

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_telegram_links" ON public.telegram_links;
CREATE POLICY "anon_all_telegram_links" ON public.telegram_links
  FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Run it in Supabase**

Dashboard → SQL Editor → paste the file's contents → Run.

Expected: "Success. No rows returned."

- [ ] **Step 3: Verify the table exists and RLS allows anon access**

```sql
insert into telegram_links (tenant_id, chat_id)
values ('00000000-0000-0000-0000-000000000000', 123456789)
returning *;

select * from telegram_links where tenant_id = '00000000-0000-0000-0000-000000000000';

delete from telegram_links where tenant_id = '00000000-0000-0000-0000-000000000000';
```

Expected: insert and select both return the one row; delete removes it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/014_telegram_notifications.sql
git commit -m "Add telegram_links table for Telegram notifications"
```

---

### Task 2: Edge Function — `telegram-notify`

**Files:**
- Create: `supabase/functions/telegram-notify/index.ts`

**Interfaces:**
- Consumes: `telegram_links` (Task 1); request body
  `{ scope: 'tenant', tenant_id, eventType, message }`,
  `{ scope: 'admin', eventType, message }`, or
  `{ scope: 'test', chat_id, message }`.
- Produces: HTTP response `{ ok: boolean }` (plus `{ ok:false,
  error:'not_linked' }` for a tenant with no active link).

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/telegram-notify/index.ts
//
// Called by the app to send one Telegram message. Body:
//   { scope: 'tenant', tenant_id, eventType, message }
//   { scope: 'admin', eventType, message }
//   { scope: 'test', chat_id, message }   -- Settings connect-flow only
// The bot token and admin chat id never leave this function.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by
// Supabase into every Edge Function. TELEGRAM_BOT_TOKEN and
// TELEGRAM_ADMIN_CHAT_ID are set in Task 3.

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const ADMIN_CHAT_ID      = Deno.env.get('TELEGRAM_ADMIN_CHAT_ID')!;

async function sbFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text || 'null') }; }
  catch { return { ok: res.ok, status: res.status, data: text }; }
}

async function sendMessage(chatId: number | string, text: string) {
  return await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  let body: any;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  const { scope, tenant_id, chat_id, eventType, message } = body || {};
  if (!scope || !message) return new Response('missing fields', { status: 400 });

  if (scope === 'test') {
    if (!chat_id) return new Response('missing chat_id', { status: 400 });
    const res = await sendMessage(chat_id, message);
    return new Response(JSON.stringify({ ok: res.ok }), { status: res.ok ? 200 : 502 });
  }

  if (scope === 'admin') {
    if (!eventType) return new Response('missing eventType', { status: 400 });
    const res = await sendMessage(ADMIN_CHAT_ID, message);
    return new Response(JSON.stringify({ ok: res.ok }), { status: res.ok ? 200 : 502 });
  }

  if (scope === 'tenant') {
    if (!tenant_id || !eventType) return new Response('missing fields', { status: 400 });

    const lookup = await sbFetch(
      `telegram_links?tenant_id=eq.${encodeURIComponent(tenant_id)}&revoked=eq.false&select=*`
    );
    const link = Array.isArray(lookup.data) ? lookup.data[0] : null;
    if (!link) {
      return new Response(JSON.stringify({ ok: false, error: 'not_linked' }), { status: 404 });
    }

    const res = await sendMessage(link.chat_id, message);
    if (res.status === 403) {
      await sbFetch(`telegram_links?id=eq.${link.id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ revoked: true }),
      });
    }
    return new Response(JSON.stringify({ ok: res.ok }), { status: res.ok ? 200 : 502 });
  }

  return new Response('unknown scope', { status: 400 });
});
```

- [ ] **Step 2: Deploy it via the Supabase Dashboard**

Dashboard → Edge Functions → Create a new function → name it
`telegram-notify` → paste the file's contents → Deploy.

Expected: function shows status "Deployed", with an invoke URL like
`https://tkrsebalgonimmozbgqc.supabase.co/functions/v1/telegram-notify`.

- [ ] **Step 3: Verify the client-facing error paths (no bot token needed yet)**

```bash
curl -X POST 'https://tkrsebalgonimmozbgqc.supabase.co/functions/v1/telegram-notify' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'apikey: <anon-key>' \
  -d '{"scope":"tenant","tenant_id":"22222222-2222-2222-2222-222222222222","eventType":"lowStock","message":"test"}'
```

Expected: HTTP 404, body `{"ok":false,"error":"not_linked"}`.

```bash
curl -X POST 'https://tkrsebalgonimmozbgqc.supabase.co/functions/v1/telegram-notify' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'apikey: <anon-key>' \
  -d '{"scope":"bogus","message":"x"}'
```

Expected: HTTP 400, body `unknown scope`.

**Both curls MUST include the `Authorization`/`apikey` headers with a
real anon key** (the same value as `CAFLAT_SB_ANON` in `js/license.js`)
— omitting them returns Supabase's own gateway-level
`{"message":"Invalid credentials","code":"INVALID_CREDENTIALS"}` before
the request ever reaches this function, which is a different failure
than what this step is testing for.

(Full send-a-real-message verification for all three scopes happens in
Task 3, once the bot token and admin chat id exist.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/telegram-notify/index.ts
git commit -m "Add telegram-notify Edge Function (tenant/admin/test scopes)"
```

---

### Task 3: Bot setup — create the bot, deploy secrets

Operational, not code — later tasks depend on it working.

**Files:** none (Telegram app + Dashboard only)

- [ ] **Step 1: Create the bot**

In Telegram, message **@BotFather** → `/newbot` → name it "Caflat.CORE
Alerts" → username `CaflatCOREAlertsBot` (must end in "bot"). Copy the
API token BotFather replies with.

- [ ] **Step 2: Set the bot token secret**

Dashboard → Edge Functions → Manage secrets → add
`TELEGRAM_BOT_TOKEN` = the token from Step 1.

- [ ] **Step 3: Get your own admin chat id**

In Telegram, message **@userinfobot** (a free public bot) — it replies
instantly with your numeric chat ID. Copy it.

- [ ] **Step 4: Set the admin chat id secret**

Dashboard → Edge Functions → Manage secrets → add
`TELEGRAM_ADMIN_CHAT_ID` = the chat ID from Step 3.

- [ ] **Step 5: Verify all three scopes with real Telegram delivery**

```bash
curl -X POST 'https://tkrsebalgonimmozbgqc.supabase.co/functions/v1/telegram-notify' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'apikey: <anon-key>' \
  -d '{"scope":"admin","eventType":"accessRequest","message":"Plan verification: admin message"}'
```

Expected: `{"ok":true}` and a real message arrives in your own chat.

```bash
curl -X POST 'https://tkrsebalgonimmozbgqc.supabase.co/functions/v1/telegram-notify' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'apikey: <anon-key>' \
  -d '{"scope":"test","chat_id":<your chat id>,"message":"Plan verification: test-scope message"}'
```

Expected: `{"ok":true}` and the message arrives in the same chat (proves
the `test` scope's raw-chat_id path works — this is what the Settings
connect flow will use in Task 10).

For the `tenant` scope, insert a real link row first:

```sql
insert into telegram_links (tenant_id, chat_id)
values ('11111111-1111-1111-1111-111111111111', <your chat id>);
```

```bash
curl -X POST 'https://tkrsebalgonimmozbgqc.supabase.co/functions/v1/telegram-notify' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'apikey: <anon-key>' \
  -d '{"scope":"tenant","tenant_id":"11111111-1111-1111-1111-111111111111","eventType":"lowStock","message":"Plan verification: tenant message"}'
```

Expected: `{"ok":true}` and the message arrives.

- [ ] **Step 6: Clean up the test row**

```sql
delete from telegram_links where tenant_id = '11111111-1111-1111-1111-111111111111';
```

No git commit for this task (no files changed).

---

### Task 4: Client helpers — `notifyTelegram()` and `notifyTelegramAdmin()`

**Files:**
- Modify: `js/license.js:6-7` (add a constant), after line 191 (add
  `notifyTelegramAdmin`)
- Modify: `js/storage.js` (add `notifyTelegram`, after `pushKpiSnapshot`)

**Interfaces:**
- Produces: `notifyTelegram(eventType: string, message: string): Promise<void>`
  (reads `APP_STATE.settings.telegramLinked` and
  `APP_STATE.settings.telegramEvents[eventType]`); `notifyTelegramAdmin(eventType: string, message: string): Promise<void>`.

- [ ] **Step 1: Add the Edge Functions URL constant**

In `js/license.js`, right after the existing constants (after line 7):

```js
const CAFLAT_SB_FUNCTIONS_URL = `${CAFLAT_SB_URL}/functions/v1`;
```

- [ ] **Step 2: Add `notifyTelegramAdmin()` to `js/license.js`**

Right after `getTenantId()` (after line 191):

```js
/* ── Telegram: platform-admin notify (new access/upgrade requests) ── */
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

- [ ] **Step 3: Add `notifyTelegram()` to `js/storage.js`**

Right after `pushKpiSnapshot()` (after the `return { success: res.ok };`
line at 775, before the `scheduleKpiSnapshotPush` comment block):

```js
/* ── Telegram: tenant-scoped event notify ──────────── */
// Gated on both the per-event toggle and an active link; silent on any
// failure so a notify problem never blocks the action that triggered it.
async function notifyTelegram(eventType, message) {
  if (!APP_STATE.settings?.telegramLinked) return;
  if (APP_STATE.settings?.telegramEvents?.[eventType] === false) return;
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) return;
  try {
    await fetch(`${CAFLAT_SB_FUNCTIONS_URL}/telegram-notify`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
      },
      body: JSON.stringify({ scope: 'tenant', tenant_id: tenantId, eventType, message }),
    });
  } catch (e) { /* silent — never blocks the underlying action */ }
}
```

(`telegramEvents[eventType] === false` rather than `!== true`, so a
tenant who links Telegram before Task 10 ships still gets notified by
default, matching "all defaulting on.")

- [ ] **Step 4: Verify both helpers load without a syntax error**

```bash
node --check js/license.js && echo license.js OK
node --check js/storage.js && echo storage.js OK
```

Expected: both print OK.

- [ ] **Step 5: Commit**

```bash
git add js/license.js js/storage.js
git commit -m "Add notifyTelegram/notifyTelegramAdmin client helpers"
```

---

### Task 5: Trigger — low stock

**Files:**
- Modify: `js/storage.js:18` (near the top, before `persistState()`) and
  `js/storage.js:74` (inside `persistState()`)

**Interfaces:**
- Consumes: `notifyTelegram()` (Task 4), `getLowStockItems()` and
  `getLowStockProducts()` (existing, `js/analytics.js:150-160`).
- Produces: a new module-level `_lastLowStockNames` set (in-session
  only).

> Per the Global Constraints: this must NOT be nested inside
> `pushKpiSnapshot()`, which early-returns on `_cloudEligible()` (PRO+
> tier only). It gets its own throttle, hooked directly off
> `persistState()`, so it works on every tier.

- [ ] **Step 1: Add the throttled check near the top of `js/storage.js`**

Right before `function persistState()` (line 18):

```js
// Module-level: names currently known to be low, so we only notify when
// a *new* name crosses the threshold, not every save while it stays low.
let _lastLowStockNames = new Set();
let _lastLowStockCheck = 0;
let _lowStockCheckQueued = false;
const LOW_STOCK_CHECK_INTERVAL_MS = 60 * 1000; // at most once a minute

function scheduleLowStockNotifyCheck() {
  if (_lowStockCheckQueued) return;
  if (Date.now() - _lastLowStockCheck < LOW_STOCK_CHECK_INTERVAL_MS) return;
  _lowStockCheckQueued = true;
  setTimeout(() => {
    _lowStockCheckQueued = false;
    _lastLowStockCheck = Date.now();
    _checkLowStockNotify();
  }, 0);
}

function _checkLowStockNotify() {
  if (typeof getLowStockItems !== 'function' || typeof getLowStockProducts !== 'function') return;
  const names = [
    ...getLowStockItems().map(i => i.name),
    ...getLowStockProducts().map(p => p.name),
  ].filter(Boolean);

  const newlyLow = names.filter(n => !_lastLowStockNames.has(n));
  _lastLowStockNames = new Set(names);
  if (!newlyLow.length) return;

  const message = newlyLow.length === 1
    ? `⚠️ Low stock: ${newlyLow[0]}`
    : `⚠️ Low stock: ${newlyLow.join(', ')}`;
  if (typeof notifyTelegram === 'function') notifyTelegram('lowStock', message);
}
```

- [ ] **Step 2: Hook it into `persistState()`**

At line 74 (right next to the existing `scheduleKpiSnapshotPush()` call
— a separate line, not nested inside it):

```js
    // Notify sync engine
    if (typeof onPersistState === 'function') onPersistState();
    // Keep the remote dashboard's daily KPI row fresh (throttled, PRO-only)
    if (typeof scheduleKpiSnapshotPush === 'function') scheduleKpiSnapshotPush();
    // Telegram low-stock alert (throttled, all tiers)
    if (typeof scheduleLowStockNotifyCheck === 'function') scheduleLowStockNotifyCheck();
  } catch (error) {
```

- [ ] **Step 3: Verify manually**

With a linked test tenant (from Task 3 Step 5 — re-link if cleaned up)
on a **FREE**-tier install, edit an ingredient's stock below its reorder
level and save. Expected: within ~1 minute, "⚠️ Low stock: <name>"
arrives. Save again immediately: expected NO second message.

- [ ] **Step 4: Commit**

```bash
git add js/storage.js
git commit -m "Notify Telegram when new items cross the low-stock threshold"
```

---

### Task 6: Trigger — new B2B order

**Files:**
- Modify: `js/supply.js:1383-1392` (`checkPortalInbox()`)

**Interfaces:**
- Consumes: `notifyTelegram()` (Task 4).

- [ ] **Step 1: Add the notify call**

```js
    if (importedCount > 0) {
      renderSupplyTable();
      renderSupplyKPIs();
      if (typeof refreshDashboard === 'function') refreshDashboard();
      showNotification(
        importedCount === 1
          ? `New client order received — review it in Supply`
          : `${importedCount} new client orders received — review them in Supply`,
        'success');
      if (typeof notifyTelegram === 'function') {
        notifyTelegram('newOrder',
          importedCount === 1
            ? `📦 New client order received. Review it in Supply.`
            : `📦 ${importedCount} new client orders received. Review them in Supply.`);
      }
    }
```

- [ ] **Step 2: Verify manually**

With a linked test tenant, submit a real order through a client's
`order.html` portal link. Wait up to 60 seconds (`_portalInboxTimer`
polls every minute). Expected: the existing toast still fires, and
"📦 New client order received. Review it in Supply." arrives.

- [ ] **Step 3: Commit**

```bash
git add js/supply.js
git commit -m "Notify Telegram when a new B2B portal order is imported"
```

---

### Task 7: Trigger — Daily Close summary

**Files:**
- Modify: `js/endofday.js:529-534` (`closeTheDay()`)

**Interfaces:**
- Consumes: `notifyTelegram()` (Task 4), existing `formatCurrency`.

- [ ] **Step 1: Add the notify call**

```js
  persistState();
  showNotification('Day closed', 'success');
  _renderEndOfDayContent();
  if (typeof _renderDailyCloseChip === 'function') _renderDailyCloseChip();
  if (typeof renderDayClosesTable === 'function') renderDayClosesTable();

  if (typeof notifyTelegram === 'function' && typeof formatCurrency === 'function') {
    notifyTelegram('dailyClose',
      `📊 Day closed — Revenue ${formatCurrency(revenue)}, ` +
      `Variance ${formatCurrency(variance)}, Drawer counted ${formatCurrency(cashCounted)}.`);
  }
}
```

- [ ] **Step 2: Verify manually**

With a linked test tenant and Daily Close enabled, run the Close-the-Day
flow to completion. Expected: "📊 Day closed — Revenue ₱X, Variance ₱Y,
Drawer counted ₱Z." arrives with the real figures.

- [ ] **Step 3: Commit**

```bash
git add js/endofday.js
git commit -m "Notify Telegram with a summary when the day is closed"
```

---

### Task 8: Trigger — new access request (landing page, admin-scoped)

**Files:**
- Modify: `landing/index.html` (bump cache-bust)
- Modify: `landing/js/main.js:540-542` (add constant + helper),
  `landing/js/main.js:599` (call it)

**Interfaces:**
- Produces: an inline `notifyTelegramAdmin` (the landing page has no
  shared JS bundle with the app — same duplication pattern already used
  for `SUPABASE_URL`/`SUPABASE_ANON`).

- [ ] **Step 1: Add the constant and inline helper**

Right after the existing constants (after line 542):

```js
const CAFLAT_SB_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

async function notifyTelegramAdmin(eventType, message) {
  try {
    await fetch(`${CAFLAT_SB_FUNCTIONS_URL}/telegram-notify`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ scope: 'admin', eventType, message }),
    });
  } catch (e) { /* silent */ }
}
```

- [ ] **Step 2: Call it after a successful insert**

```js
    if (!dbRes.ok) throw new Error(await dbRes.text());

    notifyTelegramAdmin('accessRequest',
      `🆕 New access request: ${data.cafe_name || 'Unknown café'} ` +
      `(${data.contact_name}, ${data.email}) wants ${data.tier}.`);

    showToast('Request sent! We\'ll reach out within 24–48 hours.', 'success');
    form.reset();
```

- [ ] **Step 3: Bump the cache-bust suffix**

In `landing/index.html`, bump both `?v=` suffixes by one letter (find
the current value with `grep -n '?v=202607' landing/index.html` first,
since this session's suffix has moved since this plan was written).

- [ ] **Step 4: Verify manually**

Serve locally (`python3 -m http.server 8899` from repo root) and submit
the access form with test data. Expected: existing toast/email still
fire, and "🆕 New access request: ..." arrives in the admin chat.

- [ ] **Step 5: Commit**

```bash
git add landing/index.html landing/js/main.js
git commit -m "Notify Telegram admin chat on new access requests"
```

---

### Task 9: Trigger — new upgrade request (in-app, admin-scoped)

**Files:**
- Modify: `js/license.js:876-877` (`submitUpgradeRequest()`)

**Interfaces:**
- Consumes: `notifyTelegramAdmin()` (Task 4).

- [ ] **Step 1: Add the notify call**

```js
    if (!res.ok) throw new Error('request failed');
    notifyTelegramAdmin('upgradeRequest',
      `⬆️ Upgrade request: ${APP_STATE.settings?.brandName || 'A café'} ` +
      `wants ${plan.tier}. Ref: ${reference}, contact: ${contact}.`);
    _renderUpgradeSuccess(plan);
```

- [ ] **Step 2: Verify manually**

Go through the in-app upgrade checkout flow with test values. Expected:
the existing success screen still renders, and "⬆️ Upgrade request: ..."
arrives in the admin chat.

- [ ] **Step 3: Commit**

```bash
git add js/license.js
git commit -m "Notify Telegram admin chat on new upgrade requests"
```

---

### Task 10: Settings UI — "Telegram Alerts" card

**Files:**
- Modify: `index.html` (Settings screen, next to the Remote Dashboard
  card, around line 1628's `remoteDashboardBody` div)
- Modify: `js/storage.js` (new render/connect/disconnect functions,
  alongside `renderRemoteDashboardSection`)
- Modify: `js/app.js:46` (initial render hook)

**Interfaces:**
- Produces: `renderTelegramAlertsSection()`, `connectTelegram()`,
  `disconnectTelegram()`, `toggleTelegramEvent(eventType)` — globals via
  `onclick=`/`onchange=` handlers, matching Remote Dashboard's style.
- Consumes: `telegram_links` table (Task 1), `telegram-notify`'s `test`
  scope (Task 2), `getTenantId()`.

- [ ] **Step 1: Add the card markup**

In `index.html`, right after the Remote Dashboard card's closing `</div>`
(the one right after `<div id="remoteDashboardBody"></div>`):

```html
          <!-- Telegram Alerts -->
          <div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);
            padding:16px 18px;margin-bottom:40px;background:var(--gray-50);">
            <div style="margin-bottom:12px;">
              <div style="font-size:12px;font-weight:800;">Telegram Alerts</div>
              <div style="font-size:11px;color:var(--gray-500);margin-top:2px;">
                Low stock, new orders, and day-close summaries — pushed to your phone, free
              </div>
            </div>
            <div id="telegramAlertsBody"></div>
          </div>
```

- [ ] **Step 2: Add the render/connect/disconnect functions to `js/storage.js`**

Right after `notifyTelegram()` (added in Task 4):

```js
/* ── Telegram Alerts settings card ─────────────────── */
const TELEGRAM_EVENT_LABELS = {
  lowStock:   'Low stock',
  newOrder:   'New B2B order',
  dailyClose: 'Daily Close summary',
};

async function connectTelegram() {
  const tenantId = getTenantId();
  if (!tenantId) { showNotification('No tenant on this license', 'error'); return; }

  const input = document.getElementById('telegramChatIdInput');
  const errEl = document.getElementById('telegramConnectError');
  const chatId = (input?.value || '').trim();
  if (errEl) errEl.style.display = 'none';

  if (!/^-?\d+$/.test(chatId)) {
    if (errEl) { errEl.textContent = 'That doesn\'t look like a chat ID — it should be all digits.'; errEl.style.display = 'block'; }
    return;
  }

  const btn = document.getElementById('telegramConnectBtn');
  if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }

  try {
    const res = await fetch(`${CAFLAT_SB_FUNCTIONS_URL}/telegram-notify`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
      },
      body: JSON.stringify({ scope: 'test', chat_id: Number(chatId), message: '✅ Caflat.CORE alerts connected!' }),
    });
    const data = await res.json().catch(() => ({ ok: false }));

    if (!res.ok || !data.ok) {
      if (errEl) { errEl.textContent = 'Couldn\'t reach that chat — double check the ID and try again.'; errEl.style.display = 'block'; }
      return;
    }

    const upsertRes = await fetch(`${CAFLAT_SB_URL}/rest/v1/telegram_links?on_conflict=tenant_id`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ tenant_id: tenantId, chat_id: Number(chatId), revoked: false, linked_at: new Date().toISOString() }),
    });
    if (!upsertRes.ok) {
      if (errEl) { errEl.textContent = 'Could not save the link — run migration 014 in Supabase.'; errEl.style.display = 'block'; }
      return;
    }

    APP_STATE.settings.telegramLinked = { chatId: Number(chatId), linkedAt: new Date().toISOString() };
    if (!APP_STATE.settings.telegramEvents) {
      APP_STATE.settings.telegramEvents = { lowStock: true, newOrder: true, dailyClose: true };
    }
    persistState();
    renderTelegramAlertsSection();
    showNotification('Telegram connected', 'success');
  } finally {
    if (btn) { btn.textContent = 'Connect'; btn.disabled = false; }
  }
}

async function disconnectTelegram() {
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await fetch(`${CAFLAT_SB_URL}/rest/v1/telegram_links?tenant_id=eq.${tenantId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        CAFLAT_SB_ANON,
          'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({ revoked: true }),
      });
    } catch (e) { /* revoke best-effort; local removal below always happens */ }
  }
  delete APP_STATE.settings.telegramLinked;
  persistState();
  renderTelegramAlertsSection();
  showNotification('Telegram disconnected', 'success');
}

function toggleTelegramEvent(eventType) {
  if (!APP_STATE.settings.telegramEvents) {
    APP_STATE.settings.telegramEvents = { lowStock: true, newOrder: true, dailyClose: true };
  }
  APP_STATE.settings.telegramEvents[eventType] = !APP_STATE.settings.telegramEvents[eventType];
  persistState();
}

function renderTelegramAlertsSection() {
  const box = document.getElementById('telegramAlertsBody');
  if (!box) return;
  const linked = APP_STATE.settings?.telegramLinked;

  if (linked) {
    const events = APP_STATE.settings.telegramEvents || { lowStock: true, newOrder: true, dailyClose: true };
    const rows = Object.entries(TELEGRAM_EVENT_LABELS).map(([key, label]) => `
      <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;margin-top:8px;">
        <input type="checkbox" ${events[key] !== false ? 'checked' : ''}
          onchange="toggleTelegramEvent('${key}')"> ${label}
      </label>`).join('');
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="font-size:11px;color:var(--gray-500);">Connected · chat ${linked.chatId}</div>
        <button class="btn btn-secondary btn-sm" type="button"
          style="border-color:#fca5a5;color:#dc2626;" onclick="disconnectTelegram()">Disconnect</button>
      </div>
      ${rows}`;
  } else {
    box.innerHTML = `
      <div style="font-size:11px;color:var(--gray-500);margin-bottom:10px;">
        1. Message <b>@userinfobot</b> on Telegram — it replies instantly with your numeric chat ID.<br>
        2. Paste it below.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;">
        <input id="telegramChatIdInput" type="text" inputmode="numeric" placeholder="e.g. 123456789"
          style="flex:1;min-width:160px;padding:8px 10px;border:1.5px solid var(--border);
          border-radius:var(--radius-md);font-size:12px;">
        <button id="telegramConnectBtn" class="btn btn-secondary" type="button" onclick="connectTelegram()">Connect</button>
      </div>
      <div id="telegramConnectError" style="display:none;font-size:10.5px;color:#dc2626;margin-top:6px;"></div>`;
  }
}
```

- [ ] **Step 3: Wire the initial render**

In `js/app.js`, right after the existing Remote Dashboard hook (line 46):

```js
    if (typeof renderRemoteDashboardSection === 'function') renderRemoteDashboardSection();
    if (typeof renderTelegramAlertsSection  === 'function') renderTelegramAlertsSection();
```

- [ ] **Step 4: Verify manually**

Open Settings. Expected: "Telegram Alerts" card shows the instructions +
input + Connect button. Paste an obviously-wrong ID (e.g. `000`) and
click Connect: expected an inline error, no crash, nothing saved. Get a
real chat ID from `@userinfobot`, paste it, click Connect: expected a
real Telegram message arrives, and the card flips to "Connected · chat
<id>" with three checked checkboxes. Uncheck "Low stock", trigger a
low-stock crossing (Task 5), confirm no message sends; re-check it and
confirm it does. Click Disconnect: card reverts, further `notifyTelegram`
calls get `not_linked` and are silently swallowed.

- [ ] **Step 5: Commit**

```bash
git add index.html js/storage.js js/app.js
git commit -m "Add Telegram Alerts settings card (paste-chat-ID connect, per-event toggles)"
```

---

### Task 11: Full regression pass and ship

**Files:** none (verification only)

- [ ] **Step 1: Run the existing landing-page Playwright suite**

Confirms Task 8's edit to `landing/js/main.js` introduced no regression
on the access form (structure, reveal, explorer, forms, hygiene,
reduced-motion, visual screenshots at 1440/1024/390/1366×1024).

- [ ] **Step 2: App-side manual smoke test**

Walk through: a sale that drops a product below reorder level, a portal
order import, a Daily Close, an in-app upgrade request submission —
confirm each still completes normally and each Telegram message arrives
correctly worded.

- [ ] **Step 3: Failure-path check**

Disconnect Telegram mid-session, repeat the sale/close/order actions.
Expected: all complete successfully with their normal toasts; no
Telegram messages send; no console errors from the swallowed
`notifyTelegram` failures.

- [ ] **Step 4: Ship**

Push the branch, open a PR summarizing the five triggers and the
Settings card, squash-merge, re-sync the local branch to `origin/main`.
