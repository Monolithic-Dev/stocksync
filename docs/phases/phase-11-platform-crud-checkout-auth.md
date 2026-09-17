# Phase 11 [CONDITIONAL — Tier 2]: Platform CRUD, Checkout & Cognito Auth

**Do not start this phase unless Phase 7's exit criterion was met on or before schedule.** Per `11-PHASED-SCOPE.md`, this entire phase is additive breadth, not required scope — if Phase 7 ran long, skip straight to Phase 9/10 with Tier 1 as the complete submission.

## Header

**Goal:** Real product/category/supplier/shop CRUD exists, a multi-item checkout flow submits through the *same* transaction pipeline as a manual sale, and Cognito-based auth replaces the hardcoded "Counter A/B" identities with real roles.

**Preconditions:** Phase 10's Tier-1 submission checklist is not blocked by this phase starting — if in doubt, treat Phase 10 as always runnable in parallel/instead. Phase 7 complete.

**Implements:** `01-PRD.md` §14.1/§14.2/FR-15/FR-16/FR-17, `02-ARCHITECTURE.md` §10.1/§10.2/§10.3, `03-DATABASE-SCHEMA.md` §8.1–8.4, `04-API-SPEC.md` §5.1/§5.2, `11-PHASED-SCOPE.md` items 2.1–2.3.

---

## Task Breakdown

1. **`infra/cdk/lib/constructs/AuthLayer.ts`** — Cognito User Pool + App Client, custom attributes for `role` (`owner`/`manager`/`counter_staff`) and `shop_id`. Wire an API Gateway Cognito authorizer onto the new endpoints below (the Tier-1 endpoints keep their existing API-key auth — don't retrofit auth onto working, already-rehearsed Tier-1 paths under time pressure).

2. **`infra/cdk/lib/constructs/PlatformCrud.ts`** — `products`, `categories`, `suppliers`, `shops`, `users` tables exactly per `03-DATABASE-SCHEMA.md` §8.1–8.3, plus five thin Lambda handlers.

3. **`apps/api/src/handlers/{productsCrud,categoriesCrud,suppliersCrud,shopsCrud,usersCrud}.ts`** — standard REST CRUD, authorization-scoped to the requester's `shop_id` from their Cognito token claims. **No merge/conflict logic in any of these** — per `senior-architect` skill, this data isn't subject to concurrent-offline-edit conflicts the way live inventory state is; plain last-write-wins is the correct, deliberate choice here.

4. **`apps/api/src/handlers/checkout.ts`** — `POST /checkout`: translates a multi-item cart into a batch of `sale`-type entries sharing one `order_id`, and submits them through the *existing, unmodified* `POST /transactions` handler internally (import and call, don't duplicate the intake logic). Writes an `orders` table summary row (per `03-DATABASE-SCHEMA.md` §8.4) for the receipt view — this table is a summary, never a second source of truth for stock.

5. **Frontend additions:** `apps/web/src/pages/{ProductsPage,CheckoutPage,LoginPage}.tsx`, `apps/web/src/components/{ProductForm,CartDrawer}.tsx`.

6. **Tests:** CRUD handlers — shop-scoping is enforced (a token for shop A cannot read/write shop B's products, `403`). Checkout — completing a cart with 2 line items produces exactly 2 entries in `audit_log` with a shared `order_id`, and stock decrements correctly for both, using the same idempotency/ordering guarantees as a manual sale (reuse Phase 5's assertions, don't reinvent them).

## Real-World Engineering Concerns

- **Checkout must not become a second write path.** If a future edit makes `checkout.ts` write to `inventory_records` directly instead of calling through the transaction pipeline, that's a regression to a bypass the architecture specifically avoids — see `senior-architect`'s "quick fix" watch-out.
- **Shop-scoped authorization** is now a real security surface (edge case E-1, previously an accepted limitation) — test the cross-shop-access-denied case explicitly, not just the happy path.

## Definition of Done

- [ ] A user can log in via Cognito and only see/edit their own shop's products/categories/suppliers.
- [ ] A completed checkout with 2+ items correctly decrements stock for each item and appears in `audit_log` grouped by `order_id`.
- [ ] Attempting to access another shop's data with a valid token for a different shop returns `403`.
- [ ] The Tier-1 demo scenario (Phase 7) still passes unmodified — this phase must not regress it.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Retrofitting Cognito auth accidentally touches the Tier-1 endpoints' existing API-key auth | Keep the two auth mechanisms on clearly separate route sets in `RealtimeApi.ts`; don't refactor Tier-1's working auth "while you're in there" |
| Checkout re-implements transaction logic instead of calling through it | Code-review this specifically before merging — the whole point of this task is reuse, not a parallel implementation |

## Time Budget

**Not pre-allocated** — this is "Extra Day A" from `11-PHASED-SCOPE.md`, only spent if Phase 7 finished early. If started and running long, stop at whatever sub-step is complete and move to Phase 9/10 with Tier 1 as the submission; a half-finished CRUD screen visible in the demo is worse than not having it.

## Handoff

If completed: Phase 12 can build analytics/notifications on top of real shop/product data instead of the Tier-1 seed set. If not attempted: no impact on Phase 9/10, which depend only on Tier 1. Tag: `phase-11-complete` (only if reached).
