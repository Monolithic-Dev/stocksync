# Phase 6: Client — Offline Queue & Core UI

## Header

**Goal:** StockSync Counter — a deliberately thin React client — can go offline via a real in-UI control, queue sales/restocks locally, and replay them correctly on reconnect, with a visible queue drawer and connectivity indicator.

**Preconditions:** Phase 4 complete (`POST /transactions` and `GET /sync` reachable). Phase 5 Part A complete (writes actually resolve, so the client has something real to talk to). Phase 5 Part B optional (client works with WebSocket push or `GET /sync` polling — build against whichever exists).

**Implements:** `01-PRD.md` §5.2 (client scope — explicitly thin, no real POS features), FR-12/FR-13/FR-14, `06-FOLDER-STRUCTURE.md`'s `apps/web` tree, `07-EDGE-CASES.md` C-1 through C-5, F-1 through F-4.

---

## Task Breakdown

1. **`apps/web/src/offline/db.ts`** — IndexedDB setup via `idb`:
   - Object store `pending_transactions`, keyed by `idempotencyKey`.
   - `enqueue(idempotencyKey, payload)`, `listPending()`, `clearPending(idempotencyKey)`.

2. **`apps/web/src/hooks/useConnectivity.ts`**:
   - Wraps `navigator.onLine` **and** a manual override state, since the demo needs a real in-UI toggle (edge case: DevTools throttling isn't a controllable, repeatable demo mechanism).
   - Exposes `{ isOnline, toggleOffline() }`.

3. **`apps/web/src/hooks/useOfflineQueue.ts`**:
   - `submitTransaction(txn)`: if `isOnline` is false, `enqueue()` to IndexedDB and update local optimistic state immediately (edge case F-1: allow an offline sale even if locally-known stock looks low — the local view may be stale).
   - If online, `POST /transactions` directly.
   - `replayQueue()`: on reconnect, `listPending()`, submit all in the order they were created (oldest first) as a single batch to `POST /transactions`, then `clearPending()` for each that returns `applied`/`duplicate`/`conflict_resolved`/`needs_review` (all four are "handled," not just `applied`).
   - **Handle edge case C-1** explicitly: a request sent but whose response never arrived (e.g. connectivity dropped mid-request) must resubmit with the *same* idempotency key on next replay — never generate a new key for a retry of the same logical action.

4. **`apps/web/src/offline/replay.ts`** — the reconnect trigger: a `window.addEventListener("online", ...)` handler (for real network changes) plus a call from the manual toggle's "go online" action, both funneling into `replayQueue()`.

5. **`apps/web/src/state/ShopContext.tsx`** — React Context + `useReducer` holding: current items (from `GET /sync`), connectivity state, queue drawer contents, active conflicts. No external state library (per `05-TECH-STACK.md`'s justification).

6. **`apps/web/src/hooks/useWebSocketSync.ts`** (only if Phase 5 Part B shipped):
   - Connects to `wss://...?shop_id=X&counter_id=Y` on mount.
   - On `record_updated` or `needs_review` messages, dispatches into `ShopContext`.
   - If Phase 5 Part B was cut, this hook is replaced by a simple polling `useEffect` calling `GET /sync` every few seconds instead — same `ShopContext` dispatch shape either way, so downstream components don't know or care which transport is active.

7. **Components** (`apps/web/src/components/`):
   - `ItemCard.tsx` — item name, live stock, price, sell/restock buttons.
   - `ConnectivityToggle.tsx` — the real, visible, clickable online/offline switch (this is a standout demo feature per `10-DEMO-PLAN.md` — build it as a first-class control, not a debug checkbox).
   - `QueueDrawer.tsx` — lists pending local transactions with animated status: `Queued` → `Replaying...` → `Reconciled`.
   - `AttributionBadge.tsx` — small colored tag showing which counter last touched a given field (data comes from `field_last_writer` in the synced item).
   - `ConflictReviewPanel.tsx` — scaffolded in this phase, fully wired in Phase 8 once the Bedrock explanation exists; for now, shows the two raw candidate values and a "pick one" action calling `POST /conflicts/{item_id}/resolve`.
   - `AuditLogView.tsx` — scaffolded here, populated by `GET /audit/{item_id}`; the demo's proof-of-correctness screen.

8. **`apps/web/src/pages/CounterPage.tsx`** — assembles the above into one screen representing "one counter." The demo runs two browser windows of this same page with different `counter_id` query params/local identity.

9. **`apps/web/src/api/client.ts`** — thin typed fetch/WebSocket wrapper; imports request/response types from `packages/core` where they overlap (e.g. the transaction shape), so the client and the Lambda handlers can never silently disagree on a field name.

10. **Seed data:** `scripts/seed-demo-data.ts` — populates `inventory_records` with 2–5 items (Parle-G, rice, milk — per the project's running example) so the client has something real to display from first load.

## Real-World Engineering Concerns

- **Optimistic local state must reconcile, not just display, once the real response arrives.** If a locally-optimistic sale conflicts with a `needs_review` result, the UI must transition into showing that conflict clearly, not silently keep showing the optimistic (possibly wrong) value.
- **IndexedDB persistence across tab closes (edge case C-2):** on app load, always check for and resume any pending queue before rendering the "everything is synced" state — a closed-then-reopened tab with unsent transactions must not look falsely clean.
- **Client timestamps are for display only, never for logic** (edge case C-4) — this client never makes an ordering decision based on `Date.now()`; that's exclusively the server's vector-clock job.

## Definition of Done

- [ ] Clicking the connectivity toggle to "offline," performing a sale, and seeing it appear in the queue drawer as `Queued` — without touching DevTools.
- [ ] Clicking back to "online" transitions that same entry through `Replaying...` to `Reconciled`, and the item's stock display updates to match the server's resolved value.
- [ ] Closing and reopening the browser tab with a still-queued transaction resumes and replays it correctly (edge case C-2, manually verified).
- [ ] Two browser windows (two counters) both loading `GET /sync` show the same seeded items with matching initial stock.
- [ ] `AttributionBadge` correctly shows which counter most recently changed a field, verified by editing the same item from both windows and checking each field's badge independently.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| IndexedDB browser quirks differ across the browser used for development vs. the one used for recording | Pick one browser for the whole build-and-demo cycle (per `10-DEMO-PLAN.md`'s rehearsal discipline) and don't cross-test unless something looks wrong |
| The optimistic-UI reconciliation logic becomes more complex than the thin-client scope intends | Re-read `01-PRD.md` §5.2's explicit non-goals list if this phase starts growing real point-of-sale features — the client is proof of the engine, not a product |

## Time Budget

**1 day.** If this runs long, cut visual polish on `QueueDrawer`'s animation first (a static status label is an acceptable substitute) — do not cut the actual offline-queue-and-replay mechanics, since Phase 7 depends entirely on this working correctly, not on it looking polished yet (polish is Phase 9's job if time remains).

## Handoff

Phase 7 can now assume: a working thin client exists that can go offline via a real control, queue writes, and replay them, displaying live (or polled) state from the server. Tag: `phase-6-complete`.
