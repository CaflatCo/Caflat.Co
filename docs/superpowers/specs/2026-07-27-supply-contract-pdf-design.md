# Supply Contract PDF — Design

## Problem

A cafe owner configures a B2B client's Terms & Pricing in the Order Portal
(Supply > client > Order Portal — pricing mode, settlement modes, rush fee,
payment methods, in `js/supply.js`), but that configuration only exists as
form state inside the app. Once the owner and the client have settled on
terms, there's no way to hand the client a document that states those terms
plainly — something to send, print, or keep on file.

## Scope

- Only the existing B2B "clients" configured under Supply > Order Portal.
  Not a new supplier-relationship concept, not raw-ingredient suppliers
  (which this app doesn't model).
- Purely a document-generation feature triggered by the cafe owner. There is
  no new client-facing acceptance/agreement step — the client doesn't act
  in-app to "decide" on terms; the owner decides, on their side, when to
  generate the document (e.g. after a phone call or negotiation elsewhere).
- No new data is captured or stored by this feature. Everything printed
  already lives on `client.portal` (pricing, settlement modes, rush fee,
  built-in payment method toggles) and `client.{name,contact,email,address}`.

## Non-goals

- No e-signature capture, no acceptance workflow, no new database fields or
  migrations.
- No invented legal boilerplate (governing law, liability, term/expiry
  clauses). The document states only what the app actually tracks, framed
  in plain language, dated as effective from generation with no end date
  (there's no contract-duration concept anywhere in the app to draw one
  from).
- No itemized per-product price list. The Pricing section states the
  configured *rule* (e.g. "15% off standard retail pricing applies"), not a
  line-by-line catalog.

## Document content

Title: **"Supply Agreement — Terms & Pricing"** — not "Contract." This app
doesn't track anything a lawyer would call contract terms (liability,
governing law, dispute resolution), so titling it "Contract" would imply
more legal weight than the content actually carries. "Agreement" describes
what it actually is: a written record of terms two parties settled on.

1. **Header** — brand name (`APP_STATE.settings.brandName`), the title,
   the client's name/contact/email/address (`client.contact`, `client.email`,
   `client.address` — already collected when a client is created), and the
   generation date.
2. **Terms** — Standard Sale or Consignment
   (`client.portal.termsMode`). If Consignment, list which settlement modes
   are enabled (`client.portal.settlementModes.payNow` /
   `.invoiceAfter`) as plain sentences: "They may pay in-portal when
   reporting sold stock" if `payNow`, and "Unsold-stock reports are billed
   after reconciliation" if `invoiceAfter`. Both checkboxes are independent
   in the Client Portal modal (no validation requires at least one), so
   both sentences may appear, only one may, or — if the owner has left both
   unchecked — neither, in which case this subsection is omitted entirely
   rather than printing an empty heading.
3. **Pricing** — one sentence describing the configured rule
   (`client.portal.pricing.mode` — retail / percent / amount), using the
   same resolution logic as `resolvePortalPrice()`. If this client also has
   any per-product custom overrides (`client.portal.pricing.custom`) beyond
   the general rule, add one caveat sentence noting that some products carry
   individually negotiated pricing — never silently print a "rule" that
   isn't the whole truth for this client.
4. **Payment methods accepted** — built by reusing the exact list-assembly
   logic already used when publishing the order portal (around
   `js/supply.js:1230-1241`): builtin Cash/Invoice per
   `client.portal.builtinMethods`, plus configured QR/bank methods from
   `APP_STATE.settings.paymentMethods`.
5. **Rush fee** — shown only if `client.portal.rushFee.enabled`, as "Orders
   requested with less than `thresholdHrs` hours' notice incur a
   `percent`% rush surcharge."
6. **Signature block (optional, see toggle below)** — "Agreed and
   Accepted," two columns (the business / the client), each with a
   signature line, printed name line, and date line.

## UI

**Entry point:** a new item, **"Contract PDF"**, in the client row's 3-dot
menu in `renderClientsList()` (`js/supply.js`), alongside the existing
Edit/Delete/Consignment Stock entries. Wired through `js/uiActions.js` the
same way every other row-menu action already is
(`data-action="client-contract"`).

**Preview tab, not straight-to-print:** clicking it opens a new tab/window
built the same way `printClientStatement()` already builds the Statement of
Account PDF — a full HTML document written via `window.open()` +
`document.write()`. Unlike the Statement PDF, this document does **not**
auto-print on load. Instead the tab shows:

- A screen-only checkbox, **"Include signature lines,"** checked by
  default (this feature exists for the moment you've actually settled
  terms with someone, so the signature-ready version is the sensible
  default; unchecking it gives a summary-only copy for quick reference).
  Toggling it shows/hides the signature block section live, via a few
  lines of inline JS in the generated document — no server round-trip, no
  regeneration.
- A **"Print / Save as PDF"** button, styled consistently with the
  document, which calls `window.print()`.

The checkbox and button are both wrapped in a container with a `no-print`
class, hidden via `@media print { .no-print { display: none; } }`, so
neither appears in the printed output or the resulting PDF — only the
document itself does.

## Implementation

- **New function:** `printClientContract(clientId)` in `js/supply.js`,
  placed near `printClientStatement()` and following its exact structure
  (build an HTML string with inline `<style>`, `window.open('', '_blank')`,
  `win.document.write(html)`, `win.document.close()`; bail with a
  notification if `window.open` is blocked).
- **New menu entry** in `renderClientsList()`'s `row-menu-dropdown`
  template, following the existing conditional-entry pattern already used
  for "Consignment Stock."
- **New case** in `js/uiActions.js`'s action dispatch:
  `case 'client-contract': printClientContract(actionEl.dataset.id); break;`
- **No new CSS file** — the print document is self-contained inline
  `<style>`, matching `printClientStatement`'s approach exactly (the print
  window never loads `css/styles.css`).
- **Cache-bust:** bump `js/supply.js` and `js/uiActions.js` version query
  strings in `index.html` when shipped.

## Testing

- Generate the document for a Standard Sale client with default retail
  pricing, no rush fee, only Cash enabled — confirm every section that
  should be omitted (Consignment settlement, rush fee, custom-pricing
  caveat) is actually absent, not just empty.
- Generate for a Consignment client with both settlement modes on, rush fee
  on, and at least one configured QR payment method — confirm every section
  appears with correct values.
- Generate for a client with a per-product custom price override — confirm
  the caveat sentence appears.
- Toggle the signature checkbox off and on in the preview tab — confirm the
  section shows/hides without reloading the tab, and confirm via a
  print-media check that the checkbox/button controls never render on the
  printed page while the toggled content does.
- Verify `window.open` blocked (pop-up blocker) shows a
  `showNotification(..., 'error')` rather than failing silently, matching
  `printClientStatement`'s existing guard.
