# Supply Contract PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the cafe owner a "Contract PDF" action on each Supply client that renders that client's currently configured Order Portal terms (sale/consignment, pricing rule, payment methods, rush fee) as a printable document with an optional signature block.

**Architecture:** One new function, `printClientContract(clientId)`, added to `js/supply.js` next to the existing `printClientStatement()`. It reads the client's already-stored `portal` config via the existing `_getPortalConfig()` helper, builds a self-contained HTML string (inline `<style>`, no external stylesheet), and opens it in a new tab via `window.open()` + `document.write()` — the exact pattern `printClientStatement` already uses. A new 3-dot-menu entry in `renderClientsList()` and a new dispatch case in `js/uiActions.js` wire it to the UI.

**Tech Stack:** Vanilla JS, no build step, no new dependencies. Verification is by scripted browser check (Playwright driving a real page load), matching this repo's existing verification convention — there is no unit-test framework in this codebase to write `pytest`/`jest`-style tests against.

## Global Constraints

- No new files, no new CSS file, no external libraries, no schema/database changes — spec is explicit about this (`docs/superpowers/specs/2026-07-27-supply-contract-pdf-design.md`).
- Document title text is exactly **"Supply Agreement — Terms & Pricing"**, never "Contract" in the document itself (the menu entry that opens it is fine to call "Contract PDF" — that's a UI label, not the document's own title).
- No invented legal boilerplate (no governing-law clause, no liability language, no term/expiry date). Only state facts already tracked in `client.portal` / `client.{name,contact,email,address}` / `APP_STATE.settings`.
- Signature checkbox defaults to **checked**.
- Bump the cache-bust query string (`?v=...`) in `index.html` for every `.js` file this plan touches, in the final task.

---

### Task 1: `printClientContract()` — the document generator

**Files:**
- Modify: `js/supply.js` — add `printClientContract(clientId)` immediately after `printClientStatement()` (currently ends at `js/supply.js:575`, right before the blank line at 576).
- Test: no persistent test file — verify with a throwaway Playwright script (see Step 2 below), not committed to the repo.

**Interfaces:**
- Consumes: `getSupplierClients()` (returns array of client objects with `{id, name, contact, email, address, portal}}`), `_getPortalConfig(client)` (returns `{pricing:{mode,percentOff,amountOff,custom,tiers}, allowedProductIds, multiples, builtinMethods:{cash,invoice}, token, publishedAt, revoked, termsMode, settlementModes:{payNow,invoiceAfter}, rushFee:{enabled,thresholdHrs,percent}}` — defined at `js/supply.js:587`), `escapeHtml(str)`, `getCurrencySymbol()`, `showNotification(msg, type)`, `APP_STATE.settings.brandName`, `APP_STATE.settings.paymentMethods` (array of `{name, type, ...}`).
- Produces: `window.printClientContract` (global function, callable from `js/uiActions.js` in Task 2 and directly from a browser console/test script in this task).

- [ ] **Step 1: Write `printClientContract(clientId)`**

Add this immediately after `printClientStatement()`'s closing brace in `js/supply.js` (after line 575, before the existing blank line that follows it):

```js
function printClientContract(clientId) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client) return;
  const cfg   = _getPortalConfig(client);
  const brand = APP_STATE.settings?.brandName || 'Caflat.CORE';
  const sym   = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₱';
  const today = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });

  // Mirrors resolvePortalPrice()'s three pricing modes as a plain sentence,
  // not a per-product breakdown (see spec: "just the rule").
  let pricingSentence;
  if (cfg.pricing.mode === 'percent' && cfg.pricing.percentOff > 0) {
    pricingSentence = `${cfg.pricing.percentOff}% off standard retail pricing applies.`;
  } else if (cfg.pricing.mode === 'amount' && cfg.pricing.amountOff > 0) {
    pricingSentence = `${sym}${cfg.pricing.amountOff} off standard retail pricing applies.`;
  } else {
    pricingSentence = 'Standard retail pricing applies.';
  }
  // A rule sentence alone would be misleading if this client also has
  // per-product overrides — flag it rather than silently omit it.
  const hasCustomPricing = Object.keys(cfg.pricing.custom || {}).length > 0;

  const termsLines = [];
  if (cfg.termsMode === 'consignment') {
    termsLines.push('Consignment. They hold stock and pay only for what sells.');
    if (cfg.settlementModes.payNow)       termsLines.push('They may pay in-portal when reporting sold stock.');
    if (cfg.settlementModes.invoiceAfter) termsLines.push('Unsold-stock reports are billed after reconciliation.');
    // Both settlement checkboxes are independent (no validation requires at
    // least one) -- if the owner left both off, say nothing rather than
    // print an empty promise about how settlement works.
  } else {
    termsLines.push('Standard Sale. They pay in full at checkout, in the order portal.');
  }

  // Same list-assembly the order portal itself uses when publishing
  // (js/supply.js ~1230-1241) so this document can never list a method the
  // portal doesn't actually offer.
  const configuredMethodNames = (APP_STATE.settings?.paymentMethods || [])
    .map(pm => pm.name).filter(Boolean);
  const paymentMethods = [
    ...(cfg.builtinMethods.cash    ? ['Cash'] : []),
    ...(cfg.builtinMethods.invoice ? ['Invoice / On Account'] : []),
    ...configuredMethodNames.filter(name => name.toLowerCase() !== 'cash')
  ];

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Supply Agreement — ${escapeHtml(client.name)}</title>
    <style>
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#0c0b0a; padding:32px; max-width:760px; margin:0 auto; }
      .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0c0b0a; padding-bottom:16px; margin-bottom:24px; }
      .brand { font-size:18px; font-weight:900; letter-spacing:-.02em; }
      .doctitle { font-size:11px; font-weight:800; letter-spacing:2px; text-transform:uppercase; color:#666; margin-top:4px; }
      .meta { text-align:right; font-size:12px; color:#666; }
      .parties { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:28px; }
      .party .l { font-size:9px; font-weight:800; letter-spacing:1px; text-transform:uppercase; color:#999; margin-bottom:4px; }
      .party .n { font-size:15px; font-weight:800; margin-bottom:2px; }
      .party .d { font-size:12px; color:#555; line-height:1.5; }
      .section { margin-bottom:24px; }
      .section h3 { font-size:10px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; color:#999; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #eee; }
      .section p { font-size:13px; line-height:1.7; color:#222; }
      .section p + p { margin-top:6px; }
      .caveat { font-size:12px; color:#8a6d1f; background:#fef9ec; border:1px solid #f0e1b0; border-radius:6px; padding:8px 12px; margin-top:8px; }
      .methods { display:flex; flex-wrap:wrap; gap:8px; }
      .methods span { font-size:12px; font-weight:700; background:#f3f2f0; border:1px solid #e2e0dd; border-radius:999px; padding:4px 12px; }
      .sig-block { margin-top:36px; padding-top:24px; border-top:2px solid #0c0b0a; }
      .sig-title { font-size:11px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:20px; }
      .sig-cols { display:grid; grid-template-columns:1fr 1fr; gap:40px; }
      .sig-col .role { font-size:10px; font-weight:800; letter-spacing:1px; text-transform:uppercase; color:#999; margin-bottom:28px; }
      .sig-line { border-bottom:1.5px solid #0c0b0a; height:1px; margin-bottom:6px; }
      .sig-cap { font-size:9px; color:#999; margin-bottom:22px; }
      .no-print { margin-bottom:24px; padding:12px 16px; background:#f6f5f3; border:1.5px solid #e2e0dd; border-radius:10px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
      .no-print label { font-size:13px; font-weight:700; display:flex; align-items:center; gap:8px; cursor:pointer; }
      .no-print button { background:#0c0b0a; color:#fff; border:none; border-radius:8px; padding:10px 18px; font-size:12px; font-weight:800; letter-spacing:.5px; text-transform:uppercase; cursor:pointer; }
      @media print { .no-print { display:none; } body { padding:0; } }
    </style></head><body>

    <div class="no-print">
      <label><input type="checkbox" id="sigToggle" checked onchange="document.getElementById('sigBlock').style.display=this.checked?'block':'none'"> Include signature lines</label>
      <button onclick="window.print()">Print / Save as PDF</button>
    </div>

    <div class="hdr">
      <div><div class="brand">${escapeHtml(brand)}</div><div class="doctitle">Supply Agreement &mdash; Terms &amp; Pricing</div></div>
      <div class="meta">Generated ${today}</div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="l">Supplier</div>
        <div class="n">${escapeHtml(brand)}</div>
        <div class="d">This business</div>
      </div>
      <div class="party">
        <div class="l">Client</div>
        <div class="n">${escapeHtml(client.name)}</div>
        <div class="d">${[client.contact, client.email, client.address].filter(Boolean).map(escapeHtml).join(' &middot; ') || 'No contact info on file'}</div>
      </div>
    </div>

    <div class="section">
      <h3>Terms</h3>
      ${termsLines.map(l => `<p>${escapeHtml(l)}</p>`).join('')}
    </div>

    <div class="section">
      <h3>Pricing</h3>
      <p>${escapeHtml(pricingSentence)}</p>
      ${hasCustomPricing ? `<div class="caveat">Some products carry individually negotiated pricing for this client — see the current order portal for exact figures.</div>` : ''}
    </div>

    <div class="section">
      <h3>Payment Methods Accepted</h3>
      ${paymentMethods.length
        ? `<div class="methods">${paymentMethods.map(m => `<span>${escapeHtml(m)}</span>`).join('')}</div>`
        : `<p style="color:#999;">No payment methods configured yet.</p>`}
    </div>

    ${cfg.rushFee.enabled ? `
    <div class="section">
      <h3>Rush Orders</h3>
      <p>Orders requested with less than ${cfg.rushFee.thresholdHrs} hours' notice incur a ${cfg.rushFee.percent}% rush surcharge.</p>
    </div>` : ''}

    <div class="sig-block" id="sigBlock">
      <div class="sig-title">Agreed and Accepted</div>
      <div class="sig-cols">
        <div class="sig-col">
          <div class="role">${escapeHtml(brand)}</div>
          <div class="sig-line"></div><div class="sig-cap">Signature</div>
          <div class="sig-line"></div><div class="sig-cap">Printed name</div>
          <div class="sig-line"></div><div class="sig-cap">Date</div>
        </div>
        <div class="sig-col">
          <div class="role">${escapeHtml(client.name)}</div>
          <div class="sig-line"></div><div class="sig-cap">Signature</div>
          <div class="sig-line"></div><div class="sig-cap">Printed name</div>
          <div class="sig-line"></div><div class="sig-cap">Date</div>
        </div>
      </div>
    </div>

    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showNotification('Allow pop-ups to generate the contract', 'error'); return; }
  win.document.write(html);
  win.document.close();
}
```

- [ ] **Step 2: Verify with a scripted browser check**

Create `/tmp/verify-contract-gen.js` (throwaway, not committed):

```js
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(() => {
    localStorage.setItem('caflat_pro_features_restored_v1', '1');
    localStorage.setItem('caflat_gate_v1', JSON.stringify({ code: 'TEST-0000' }));
    localStorage.setItem('caflat_credentials', JSON.stringify({ username: 'admin' }));
    localStorage.setItem('caflat_auth', JSON.stringify({ username: 'admin', role: 'admin' }));
    localStorage.setItem('caflat_pos_v1', JSON.stringify({
      settings: {
        brandName: 'Maison Levain',
        shoppingListEnabled: false,
        paymentMethods: [{ name: 'GCash', type: 'qr' }, { name: 'BDO Bank Transfer', type: 'bank' }],
      },
      supplierClients: [
        { id: 'consign', name: 'Bocobo Cafe', contact: 'Maria Santos', email: 'maria@bocobocafe.ph',
          address: '42 Katipunan Ave, Quezon City',
          portal: { termsMode: 'consignment',
            settlementModes: { payNow: true, invoiceAfter: true },
            pricing: { mode: 'percent', percentOff: 15, custom: { p1: 30 } },
            builtinMethods: { cash: true, invoice: true },
            rushFee: { enabled: true, thresholdHrs: 24, percent: 5 } } },
        { id: 'sale', name: 'Sira Cafe', contact: '', email: '', address: '',
          portal: { termsMode: 'sale',
            pricing: { mode: 'retail', custom: {} },
            builtinMethods: { cash: true, invoice: false },
            rushFee: { enabled: false, thresholdHrs: 24, percent: 5 } } },
      ],
      products: [],
    }));
  });
  await page.goto('http://localhost:8899/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('firstRunOverlay')?.remove());

  let fails = 0;
  const check = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

  // Consignment client: every section should appear, with the custom-pricing caveat.
  {
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(() => printClientContract('consign')),
    ]);
    await popup.waitForLoadState();
    const text = await popup.evaluate(() => document.body.innerText);
    check('title is "Supply Agreement", not "Contract"', text.includes('Supply Agreement'));
    check('consignment terms line present', text.includes('Consignment. They hold stock'));
    check('pay-in-portal settlement line present', text.includes('They may pay in-portal'));
    check('bill-after-reconciliation line present', text.includes('Unsold-stock reports are billed'));
    check('percent-off pricing sentence present', text.includes('15% off standard retail pricing'));
    check('custom-pricing caveat present', text.includes('individually negotiated pricing'));
    check('Cash payment method present', text.includes('Cash'));
    check('Invoice payment method present', text.includes('Invoice / On Account'));
    check('GCash payment method present', text.includes('GCash'));
    check('rush fee line present', text.includes("less than 24 hours' notice"));
    check('signature block present by default', await popup.evaluate(() =>
      getComputedStyle(document.getElementById('sigBlock')).display !== 'none'));
    // Toggle off -- must hide live, no reload.
    await popup.uncheck('#sigToggle');
    check('signature block hides when unchecked', await popup.evaluate(() =>
      getComputedStyle(document.getElementById('sigBlock')).display === 'none'));
    // Print-media check: the checkbox/button controls must never render in
    // the printed output, only the document content should.
    await popup.emulateMedia({ media: 'print' });
    check('no-print controls are hidden in print media', await popup.evaluate(() =>
      getComputedStyle(document.querySelector('.no-print')).display === 'none'));
    await popup.emulateMedia({ media: 'screen' });
    await popup.close();
  }

  // window.open blocked (pop-up blocker): must notify, not fail silently.
  {
    await page.evaluate(() => { window._origOpen = window.open; window.open = () => null; });
    await page.evaluate(() => printClientContract('sale'));
    await page.waitForTimeout(100);
    check('blocked pop-up shows an error notification', await page.evaluate(() =>
      !!document.querySelector('#notificationContainer .notification.error')));
    await page.evaluate(() => { window.open = window._origOpen; });
  }

  // Sale-mode client with nothing special configured: every conditional
  // section that should be OMITTED must actually be absent.
  {
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.evaluate(() => printClientContract('sale')),
    ]);
    await popup.waitForLoadState();
    const text = await popup.evaluate(() => document.body.innerText);
    check('standard sale terms line present', text.includes('Standard Sale. They pay in full'));
    check('no consignment settlement lines leak in', !text.includes('Unsold-stock reports'));
    check('retail pricing sentence present', text.includes('Standard retail pricing applies'));
    check('no custom-pricing caveat for this client', !text.includes('individually negotiated'));
    check('no rush fee section when disabled', !text.includes('rush surcharge'));
    check('Invoice not listed (builtinMethods.invoice is false)', !text.includes('Invoice / On Account'));
    check('no contact info falls back to placeholder', text.includes('No contact info on file'));
    await popup.close();
  }

  console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})();
```

Serve the repo (`python3 -m http.server 8899` from the repo root) and run:

```
NODE_PATH=/opt/node22/lib/node_modules node /tmp/verify-contract-gen.js
```

Expected: every `check(...)` line prints `PASS`, ending with `ALL PASS` and exit code 0. If any print `FAIL`, fix `printClientContract` and rerun — do not proceed to Step 3 with a failing check.

- [ ] **Step 3: Commit**

```bash
git add js/supply.js
git commit -m "Add printClientContract() — Supply Agreement PDF generator"
```

---

### Task 2: Wire the menu entry and ship

**Files:**
- Modify: `js/supply.js` — `renderClientsList()`'s `row-menu-dropdown` template (`js/supply.js:251-261`).
- Modify: `js/uiActions.js` — add one dispatch case near the other `client-*` cases (`js/uiActions.js:621-624`).
- Modify: `index.html` — bump cache-bust for `js/supply.js` and `js/uiActions.js`.

**Interfaces:**
- Consumes: `printClientContract(clientId)` from Task 1.
- Produces: nothing new for later tasks — this is the last task.

- [ ] **Step 1: Add the menu entry**

In `js/supply.js`, inside `renderClientsList()`'s dropdown template, add a `Contract PDF` entry after the conditional Consignment Stock entry and before Edit (matches the existing grouping: contextual actions first, generic CRUD after, Delete last):

```js
          <template class="row-menu-template">
            <div class="row-menu-dropdown">
              ${c.portal?.termsMode === 'consignment'
                ? `<button type="button" data-action="consignment-ledger"
                    data-id="${c.id}">Consignment Stock</button>`
                : ''}
              <button type="button" data-action="client-contract"
                data-id="${c.id}">Contract PDF</button>
              <button type="button" data-action="edit-client" data-id="${c.id}">Edit</button>
              <button type="button" class="danger" data-action="delete-client"
                data-id="${c.id}">Delete</button>
            </div>
          </template>
```

(This replaces the existing dropdown block at `js/supply.js:251-261` — only the new `Contract PDF` button line is added; everything else stays as-is.)

- [ ] **Step 2: Wire the dispatch case**

In `js/uiActions.js`, add this line immediately after the existing `case 'client-portal':` line (`js/uiActions.js:623`):

```js
      case 'client-contract':       if(typeof printClientContract==='function') printClientContract(actionEl.dataset.id || ''); break;
```

- [ ] **Step 3: Bump cache-bust**

In `index.html`, update both script tags (exact current values as of this plan — confirm the current value first with `grep -n 'js/supply.js?v=\|js/uiActions.js?v=' index.html` in case another change has landed since, and bump from whatever it currently is, not necessarily these exact strings):

```html
  <script src="./js/uiActions.js?v=20260725b"></script>
```
→
```html
  <script src="./js/uiActions.js?v=20260727b"></script>
```

```html
  <script src="./js/supply.js?v=20260727a"></script>
```
→
```html
  <script src="./js/supply.js?v=20260727b"></script>
```

- [ ] **Step 4: Verify end-to-end from the real UI**

Extend `/tmp/verify-contract-gen.js` (or write a second throwaway script) to drive the actual menu instead of calling `printClientContract` directly:

```js
  // End-to-end: open the client list, click the 3-dot menu, click "Contract PDF".
  await page.evaluate(() => switchPage('supply'));
  await page.waitForTimeout(300);
  await page.evaluate(() => toggleSupplyRowMenu('consign', 'client'));
  await page.waitForTimeout(150);
  const [popup2] = await Promise.all([
    page.waitForEvent('popup'),
    page.click('[data-action="client-contract"][data-id="consign"]'),
  ]);
  await popup2.waitForLoadState();
  const text2 = await popup2.evaluate(() => document.body.innerText);
  check('end-to-end menu click opens the same document', text2.includes('Supply Agreement'));
  await popup2.close();
```

Expected: `PASS`. Also take one screenshot of the open dropdown showing the new "Contract PDF" entry (confirm it doesn't get clipped near the bottom of the list — the row-menu positioning fix already shipped in #194 should handle this, but confirm rather than assume, since this menu now has one more entry than anything tested there).

- [ ] **Step 5: Commit and ship**

```bash
git add js/supply.js js/uiActions.js index.html
git commit -m "Wire Contract PDF into the client row's 3-dot menu"
git push -u origin claude/caflat-core-audit-rebrand-llzwg0
```

Open a PR, verify CI/no console errors, and squash-merge — following this session's established workflow (PR description covering root feature, verification results; squash-merge once green).
