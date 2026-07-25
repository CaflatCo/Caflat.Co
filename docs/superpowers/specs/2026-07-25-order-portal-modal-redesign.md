# Order Portal Modal Redesign

**Date:** 2026-07-25
**File:** `js/supply.js` (`openClientPortalModal` and its helpers), `css/styles.css`

## Problem

The Order Portal modal (`openClientPortalModal`, `js/supply.js:691-926`) stacks
five numbered sections into a single scroll: Terms, an unnumbered rush-fee
block, General Pricing, Products, Payment Methods, and Share Link. It reads as
cramped and over-explained.

Three specific faults:

1. **Every product renders all of its fields, always.** The product card
   (`js/supply.js:713-767`) emits Custom Price, Sold In Packs Of, Volume
   Pricing and an "Add break" button for every product, including ones the
   client is not offered. Ten products means roughly forty controls on screen
   regardless of how few are actually in use. This is the single largest
   source of visual density.

2. **Two nested scrollbars.** The product list is an
   `overflow-y:auto` box capped at `min(48vh, 440px)` (`js/supply.js:867`)
   sitting inside a modal that already scrolls.

3. **Prose where labels belong.** Explanatory sentences sit under most
   controls, and the rush fee is built as a run-on sentence with two number
   inputs embedded in it (`js/supply.js:815-826`), which wraps badly at
   tablet width.

## Constraint that shapes the whole design

`_readPortalModalConfig()` (`js/supply.js:995-1051`) builds the saved config by
querying the live DOM at save time:

- `modal.querySelectorAll('.portal-custom' | '.portal-multiple' | '.portal-tier-row' | '.portal-include')`
- `document.getElementById('portalAcceptCash' | 'portalSettlePayNow' | 'portalRushHours' | ...)`
- `modal.dataset.pricingMode` and `modal.dataset.termsMode`

Any control absent from the DOM at save time is read as absent and therefore
**silently erased**. Collapsing an unoffered product by not rendering it would
destroy that product's stored custom price, pack size and volume breaks.

**Rule: hide with CSS, never unrender.** This applies to both the collapsed
product details and the inactive tab panels. `_readPortalModalConfig()` and
`_validatePortalTiers()` are not modified.

## Design

### Structure

A persistent header and footer with three CSS-toggled tab panels between them.
All three panels stay in the DOM at all times; only their `display` changes.

```
Order Portal — Engkape
[ Terms & Pricing ][ Products (5) ][ Share ]
------------------------------------------
  active panel (scrolls)
------------------------------------------
Close        Save        Save & Get Link
```

The subtitle sentence ("Set this client's prices, pick their products, then
share their private order link.") is removed. The tab labels carry that
information.

The section numbering (`1 ·`, `2 ·` … `5 ·`) is removed. It implied a required
order that never existed.

### Tab 1: Terms & Pricing

Everything that is a stored setting rather than a per-product value.

- **Terms**: segmented Standard Sale / Consignment. Selecting Consignment
  reveals the two existing settlement checkboxes plus one hint line.
- **Rush fee**: checkbox, and when enabled two separately labelled fields
  replacing the embedded sentence:
  `Notice window [24] hrs` and `Surcharge [5] %`.
- **Pricing**: segmented Standard retail / Percent off / Amount off, with the
  conditional percent or amount input beside it.
- **Payment methods**: Accept Cash / Accept Invoice, plus one hint line.

### Tab 2: Products

One row per product, with per-product detail revealed by the include checkbox.

- **Not offered**: checkbox, name, retail price, and a muted "Not offered"
  at the right edge. Single line.
- **Offered**: the same row plus its Custom Price, Pack Size and Volume
  Pricing controls beneath.

The detail block is toggled via a class on the card, not by adding or removing
markup, so values persist across toggling and across save.

The `max-height` / `overflow-y:auto` wrapper at `js/supply.js:867` is dropped.
The tab panel is the scroll container, leaving one scrollbar.

The header keeps the offered-count and the Select all / Select none controls.

### Tab 3: Share

The existing link input, Copy button, QR block and Revoke control. When no
link has been generated, the panel shows a one-line empty state pointing at
the footer's "Save & Get Link" rather than rendering an empty collapsed box.

### Footer

Pinned below the panels on every tab: `Close`, `Save`, and the primary
`Save & Get Link` (labelled `Update & Re-share Link` once a link exists,
matching current behaviour). Sharing is reachable from any tab in one click.

### Copy

| Current | Replacement |
|---|---|
| "Consignment: this client holds stock and only owes for what they report as sold. Damaged/expired units are written off, not billed." | "They hold your stock and pay only for what sells." |
| "Within `24` hours of the requested delivery date, add `5` % to the order total." | Labelled fields: `Notice window` / `Surcharge` |
| "Any QR/bank methods configured in Settings are always offered too. Uncheck both only if this client must pay another way you've set up in Settings." | "Your QR and bank methods from Settings are always offered." |
| "A custom price set on a product below always overrides this." | Removed. The Products tab shows each effective price live. |
| "(optional)", "(optional, this client only)" | Removed. Empty fields read as optional. |
| "Send this link (or let them scan the QR). Sharing again after price changes refreshes their form." | "Re-sharing after a price change refreshes their form." |

### Motion

Restrained, matching the app rather than the landing page.

- Tab panel change: opacity 0 to 1 over 180ms.
- Product detail reveal: height and opacity over 200ms.
- Both suppressed under `prefers-reduced-motion: reduce`.

### Tab state

Held in `modal.dataset.portalTab`. It does not persist across openings; the
modal always opens on Terms & Pricing. `modal.dataset.pricingMode` and
`modal.dataset.termsMode` keep their current meaning and are untouched.

## Explicitly out of scope

- No change to `_readPortalModalConfig()`, `_validatePortalTiers()`,
  `_getPortalConfig()`, or any save, share or revoke handler.
- No change to the portal config data shape or to `order.html`.
- No control is removed. Everything is regrouped or revealed on demand.

## Verification

1. **No data loss (the critical case).** Open a portal with a custom price,
   pack size and a volume break set on a product. Uncheck that product, save,
   reopen. The stored values must still be present.
2. **Save parity.** Compare the object returned by `_readPortalModalConfig()`
   before and after the redesign for identical input. It must match field for
   field.
3. **Tabs.** Each tab shows its own content; inactive panels are hidden but
   present in the DOM; the footer is visible on all three.
4. **Products.** Unchecked rows show no detail fields; checking one reveals
   them; the offered count and Select all / none still work.
5. **Single scrollbar.** No element inside the modal other than the active
   tab panel scrolls.
6. **Hygiene.** No console errors; no horizontal overflow at 1024x768 and
   1440x900; correct in light and dark mode.
7. **Visual gate.** Screenshot all three tabs at both viewports and inspect
   them for density and alignment.
