# Phase 19 [CONDITIONAL]: Barcode/QR + CRUD + Checkout

**Do not start this unless Phases 16–18 are done and genuinely rehearsed,
with real time still remaining before submission.** If they're not, stop
at Phase 18 — that's already a strong, differentiated, fully-working
submission. This phase exists to answer one specific complaint — "the
app looks simple" — not to add more depth.

## Header

**Goal:** Barcode/QR quick-entry as an alternate input method, plus real
product/checkout CRUD so the app reads as a complete product, not a
fixed demo screen.

**Preconditions:** Phase 18 complete.

**Implements:** `01-PRD.md` FR-23, Tier 2 items 2.1/2.2/2.9.

---

## Task Breakdown

### 19a. Barcode/QR quick-entry

1. Pick a client-side scanning library (`getUserMedia`-based, no server round-trip).
2. **`apps/web/src/components/BarcodeScanButton.tsx`**: decodes a code,
   resolves it to a real `item_id` by exact match against the loaded
   item list, pre-fills the existing sell/restock action. No match →
   "not recognized," never a guess.
3. Tests: known code resolves correctly; unknown code shows fallback,
   doesn't call `submitTransaction`; camera permission denial handled
   gracefully.

### 19b. CRUD + Checkout

1. **`infra/cdk/lib/constructs/PlatformCrud.ts`**: `products`,
   `categories`, `suppliers`, `shops` tables per `03-DATABASE-SCHEMA.md` §8.1–8.3.
2. **`apps/api/src/handlers/{productsCrud,categoriesCrud,suppliersCrud}.ts`**:
   standard REST CRUD — no merge/conflict logic, plain last-write-wins is
   correct here (this data isn't concurrently-edited live state).
3. **`apps/api/src/handlers/checkout.ts`** (`POST /checkout`): translates
   a multi-item cart into a batch of `sale`-type entries sharing one
   `order_id`, submitted through the *existing, unmodified*
   `POST /transactions` handler — no parallel write path.
4. **`apps/web/src/pages/{ProductsPage,CheckoutPage}.tsx`**,
   **`apps/web/src/components/{ProductForm,CartDrawer}.tsx`**.
5. Tests: checkout with 2 line items produces 2 `audit_log` entries
   sharing an `order_id`, correct stock decrements for both, same
   idempotency/ordering guarantees as a manual sale.

## Real-World Engineering Concerns

- **Checkout must never become a second write path.** If it writes to
  `inventory_records` directly instead of calling through the
  transaction pipeline, that's a regression to a bypass the architecture
  specifically avoids.
- Barcode/QR is a presentation-layer alternative — it calls the exact
  same action every other entry point does.

## Definition of Done

- [ ] Scanning a real code correctly pre-fills a sale for a seeded item.
- [ ] A completed checkout with 2+ items decrements stock correctly for
      each, grouped by `order_id` in the audit log.
- [ ] The Phase 7 core demo scenario still passes unmodified — this
      phase must not regress it.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| This phase quietly eats into recording/submission time | Stop at whichever sub-step you're on the moment time runs out — 19a alone, without 19b, is still a real, finished addition |
| Checkout reimplements transaction logic instead of calling through it | Code-review this specifically — the whole point is reuse |

## Time Budget

Not pre-allocated — spend only genuine remaining slack. If it's not
clearly there, don't start this phase at all.

## Handoff

This is the last phase. Whatever's completed here (or not) — move
straight to `phase-10-demo-recording-submission.md`.
