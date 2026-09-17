# StockSync — Edge Case Catalog

This is a working reference, not a one-time checklist — consult it while
implementing each component, and add to it as you discover more during
building and rehearsal.

---

## A. Concurrency and Ordering

| ID | Edge case | Expected behavior |
|---|---|---|
| A-1 | Two counters submit writes to the same item at literally the same millisecond | SQS FIFO's per-`record_id` message group guarantees strictly sequential processing — one is fully resolved before the other begins. No true simultaneity is possible by design. |
| A-2 | A counter's write arrives with a vector clock that's *behind* the current stored state in every entry (stale write, e.g. a very delayed retry) | This is not a conflict — it's a stale write. The system should apply it only if it doesn't lose information (i.e. treat it the same as any older concurrent write, running it through the same dominates/concurrent check) rather than assuming "arrived later" means "should overwrite." |
| A-3 | Three or more counters all edit the same item concurrently while offline (not just two) | The vector clock and PN-counter design generalize to any number of counters — the resolver doesn't hardcode "two clients," verify this with a 3-client test case explicitly, don't assume 2 is the ceiling. |
| A-4 | The same counter sends two of its own writes out of order (e.g. a batched replay where request 2 lands before request 1 due to a network quirk) | Per-counter sequence numbers inside the vector clock must be checked; the resolver should reject or reorder based on the counter's own sequence, not just wall-clock arrival time at the server. |
| A-5 | A write's vector clock references a counter ID the server has never seen before | Treat as a new counter joining — initialize its entry in the vector clock at 0 before comparing, don't error. |

---

## B. Data Integrity and Correctness

| ID | Edge case | Expected behavior |
|---|---|---|
| B-1 | A sale would bring stock below zero (e.g. two counters both sell more than is actually in stock, combined) | Decide and document a policy explicitly: either allow negative stock (and surface it as a visible anomaly, since it likely indicates a real discrepancy worth investigating) or clamp at zero and flag it — pick one and state it in the PRD/architecture rather than leaving it undefined. Recommended for the hackathon: allow it and flag visibly, since silently clamping hides a real signal. |
| B-2 | A restock and a sale of the same item, same field, arrive concurrently | These are different transaction types touching the same PN-counter but different internal sub-counters (increments vs decrements) — not a same-field conflict at all; both apply independently and cleanly. Don't accidentally treat "same item" as "same field" in the conflict-detection logic. |
| B-3 | Two counters both set the same field to the *same* value concurrently | Not a real conflict even though it's technically concurrent — detect value equality before flagging `needs_review`, since flagging an identical value as a conflict would be a false positive that erodes trust in the flagging mechanism. |
| B-4 | A `needs_review` conflict is left unresolved and a third write comes in for a different field on the same item | The unrelated field's write should proceed normally — a pending conflict on one field must not block writes to other fields of the same item. |
| B-5 | A `needs_review` conflict is left unresolved and a fourth write comes in for the *same* conflicted field | Document a policy: does the new write become a third candidate, or is it rejected until the existing conflict resolves? Recommended: add as a third candidate — don't silently drop it. |

---

## C. Network and Offline Client Behavior

| ID | Edge case | Expected behavior |
|---|---|---|
| C-1 | The client goes offline mid-request (request sent, response never received) | The client cannot know if the write actually succeeded server-side. On reconnect, it must resubmit with the *same* idempotency key so the server's dedup logic makes this safe regardless of whether the original request actually landed. |
| C-2 | The browser tab is closed while transactions are still queued locally, unsynced | IndexedDB persists across tab closes — on next open, the queue must be checked and replay resumed automatically, not lost. |
| C-3 | The client is offline for a very long period (hours), during which many other counters made many changes | `GET /sync` must return the full current state efficiently regardless of how much changed — don't design it as "replay every historical event," design it as "fetch current state," since the audit log (not the sync endpoint) is what preserves history. |
| C-4 | The client's local clock is wrong (common on real devices) | Never rely on client wall-clock time for ordering or conflict resolution — only the vector clock (logical time) determines ordering; client timestamps are stored only for human-readable audit display, never for logic. |
| C-5 | A counter reconnects but its WebSocket connects before its queued REST writes finish replaying | The client should not treat the WebSocket connection as "fully synced" — the queue drawer should only show fully "Reconciled" once each specific queued transaction's REST response has returned, independent of WebSocket connection state. |

---

## D. WebSocket Lifecycle

| ID | Edge case | Expected behavior |
|---|---|---|
| D-1 | A push is attempted to a connection that disconnected without a clean `$disconnect` event (e.g. the browser crashed) | The push call will fail with a `GoneException`-style error — catch this specifically, delete the stale row from `ws_connections`, and don't retry it. |
| D-2 | The same counter opens two browser tabs, creating two WebSocket connections for one logical counter | Both connections should receive pushes independently — don't assume one counter maps to exactly one connection; key `ws_connections` by `connection_id`, not `counter_id`. |
| D-3 | A push needs to go to 50+ connections for a very busy shop (not realistic for the demo, but worth stating the policy) | Batch or parallelize pushes rather than sequentially awaiting each one, so one slow/dead connection doesn't delay pushes to everyone else. |

---

## E. Security and Abuse (lighter-weight for a hackathon, but worth naming)

| ID | Edge case | Expected behavior |
|---|---|---|
| E-1 | A request arrives with a `shop_id` the requester's API key isn't associated with | Out of scope for the hackathon's single-shop demo, but explicitly note in the PRD as a known limitation rather than silently ignoring it — a real product would need per-shop authorization, not just a shared API key. |
| E-2 | A malicious or buggy client submits an extremely large batch of transactions in one request | Impose a reasonable batch size limit (e.g. 100 transactions per `POST /transactions` call) and return a clear `400` if exceeded, rather than letting an unbounded batch degrade Lambda performance. |
| E-3 | A client submits a negative `quantity` for a "sale" transaction to try to inflate stock | Validate that `quantity` is a positive number for both `sale` and `restock` types — the transaction `type` determines the sign of the effect, the client should never submit a signed quantity itself. |

---

## F. UI and UX

| ID | Edge case | Expected behavior |
|---|---|---|
| F-1 | A counter is offline and the operator tries to sell more than the locally-known stock shows | Allow it optimistically (the operator's local view may be stale, and real physical stock may still exist) but make clear in the UI that this is an offline, unconfirmed action — don't hard-block a legitimate sale based on a possibly-outdated local number. |
| F-2 | Two conflicting values are shown for review, and they're numerically very close (e.g. ₹10 vs ₹10.50) | Don't round or truncate the displayed values in a way that could hide the actual discrepancy — always show full precision in the conflict-review screen. |
| F-3 | The Bedrock explanation hasn't returned yet when the conflict banner first appears | Show the raw conflicting values immediately; render the explanation as "Generating explanation…" and update in place when it arrives, rather than blocking the whole banner on Bedrock's response. |
| F-4 | The demo's "network kill switch" is toggled back online while a resolution is actively in flight from the *other* counter | The UI should handle receiving a `record_updated` push for an item it doesn't currently think is in a conflicted state — always trust the server's pushed state over any locally-assumed state. |

---

## G. AI (Bedrock) Specific

| ID | Edge case | Expected behavior |
|---|---|---|
| G-1 | Bedrock returns an empty or malformed response | Treat as "explanation unavailable" — never block the conflict-flagging or display on this; the raw conflicting values are always sufficient to resolve manually without the AI explanation. |
| G-2 | Bedrock's explanation is factually confident-sounding but the underlying conflict is genuinely ambiguous (e.g. it guesses which price is "more likely correct" with no real basis) | Frame the UI copy around the explanation as advisory context, not a recommendation to blindly follow — the human still explicitly picks a value; the AI never auto-resolves the conflict itself, matching PRD FR-7's wording precisely ("alongside both raw values," not "instead of"). |
| G-3 | Bedrock call takes long enough to noticeably delay the demo if not handled asynchronously | Never make the Bedrock call synchronous/blocking within the same Lambda invocation that resolves and pushes the core conflict state — fire it as a secondary, best-effort step (or a separate async invocation) so the core correctness guarantee is never dependent on an external AI service's latency. |

---

## How to Use This Doc While Building

When you implement each handler in `apps/api/src/handlers/`, check this
list for the section relevant to that handler and write at least one test
(unit, integration, or manual script) per applicable edge case before
considering that handler done. This is the discipline that turns "we
thought about edge cases" from a claim in a PRD into something you can
actually demonstrate if asked.
