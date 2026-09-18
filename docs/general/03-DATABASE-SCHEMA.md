# StockSync — Database Schema (DynamoDB)

DynamoDB schema design should always start from access patterns, not
from "what tables feel natural" — this doc follows that discipline.

---

## 1. Access Patterns (defined before any table design)

| # | Access pattern |
|---|---|
| AP-1 | Get an item's current state by `item_id` |
| AP-2 | Check whether a given `idempotency_key` has already been processed |
| AP-3 | Append an audit event for an item |
| AP-4 | Get the full audit history for an item, in chronological order |
| AP-5 | Get all currently-connected WebSocket connections for a given shop |
| AP-6 | Remove a WebSocket connection on disconnect or on a failed push |
| AP-7 | List all items currently flagged `needs_review` for a shop (for the conflict-review screen) |

Every table below exists to serve one or more of these directly — there
are no speculative tables "just in case."

---

## 2. Table: `inventory_records`

Serves AP-1 and AP-7.

| Attribute | Type | Notes |
|---|---|---|
| `pk` (partition key) | String | `SHOP#<shop_id>#ITEM#<item_id>` |
| `sk` (sort key) | String | `CURRENT` (only one current-state item per key; history lives in `audit_log`, not here) |
| `name` | String | e.g. "Parle-G 100g" |
| `base_stock` | Number | the stock count at initialization, before any increments/decrements |
| `pn_counter` | Map | `{ increments: { [counter_id]: number }, decrements: { [counter_id]: number } }` |
| `stock` | Number | denormalized, computed value: `base_stock + sum(increments) - sum(decrements)` — stored for fast reads, recomputed on every resolved write |
| `price` | Number | current price |
| `shelf_location` | String | optional |
| `supplier` | String | optional |
| `expiry_date` | String | optional, ISO date (YYYY-MM-DD) — perishables only. Field-merged exactly like `price`/`shelf_location`; needed zero changes to `fieldMerge.ts` since it operates on field names generically (15b) |
| `vector_clock` | Map | `{ [counter_id]: sequence_number }` |
| `field_last_writer` | Map | `{ [field_name]: counter_id }` |
| `conflict_status` | String | `none` \| `needs_review` |
| `conflict_candidates` | Map (nullable) | present only when `conflict_status = needs_review`; e.g. `{ field: "price", values: [{counter_id, value, client_timestamp, server_timestamp}, ...], overlap_seconds: number }` — `client_timestamp` from each write's payload is used to compute `overlap_seconds`, the approximate duration both devices were offline and edited concurrently. **Approximate, not authoritative** — computed from client-device clocks, which edge case C-4 already establishes can be wrong or unsynchronized between devices. Passed to Bedrock as advisory context for its explanation only; never used by `resolve()`'s actual decision logic, which depends solely on vector clocks. |
| `updated_at` | String (ISO timestamp) | |

**GSI-1 — `ShopConflictIndex`:** partition key `shop_id`, sort key
`conflict_status`. Serves AP-7 (list all `needs_review` items for a
shop) without a table scan.

---

## 3. Table: `write_dedup`

Serves AP-2.

| Attribute | Type | Notes |
|---|---|---|
| `idempotency_key` (partition key) | String | client-generated UUID |
| `item_id` | String | |
| `counter_id` | String | which counter submitted this write |
| `client_timestamp` | String (ISO) | the time the write was made on the client device — used to compute `overlap_seconds` when paired with another concurrent write |
| `status` | String | `queued` \| `applied` \| `conflict_resolved` \| `needs_review` |
| `cached_response` | Map | the exact response returned the first time, replayed verbatim on duplicate submission |
| `ttl` | Number (epoch seconds) | expires 7 days after creation — no need to keep idempotency records forever |

DynamoDB's native TTL feature handles automatic expiry, no cleanup job
needed.

---

## 4. Table: `audit_log`

Serves AP-3 and AP-4.

| Attribute | Type | Notes |
|---|---|---|
| `pk` (partition key) | String | `SHOP#<shop_id>#ITEM#<item_id>` |
| `sk` (sort key) | String | `<ISO timestamp>#<event_id>` — naturally sorts chronologically |
| `counter_id` | String | which counter triggered this event |
| `action` | String | `sale` \| `restock` \| `field_update` \| `conflict_detected` \| `conflict_resolved_auto` \| `conflict_resolved_manual` |
| `resolution_strategy` | String (nullable) | `pn_counter_merge` \| `field_merge` \| `needs_review` \| `manual` |
| `details` | Map | free-form context — the specific values involved, for the audit UI to render human-readably |

Querying `pk = SHOP#x#ITEM#y` with the sort key gives the full
chronological history for that item directly — this is exactly the
screen the demo's audit trail relies on.

---

## 5. Table: `ws_connections`

Serves AP-5 and AP-6. **Should-have, not a must-have** — see
`01-PRD.md` Section 6.2. If the WebSocket push path is cut for time, this
table is simply never created; nothing else in the schema depends on it.

| Attribute | Type | Notes |
|---|---|---|
| `connection_id` (partition key) | String | assigned by API Gateway on `$connect` |
| `shop_id` | String | which shop this connection is watching |
| `counter_id` | String | which counter this connection represents |
| `connected_at` | String (ISO timestamp) | |

**GSI-1 — `ShopConnectionsIndex`:** partition key `shop_id`. Serves AP-5
(find all connections to notify for a given shop) directly.

---

## 6. Example Items (for seeding and for reasoning about the demo)

### `inventory_records` — a clean item, no conflict

```json
{
  "pk": "SHOP#demo-shop#ITEM#parle-g",
  "sk": "CURRENT",
  "name": "Parle-G 100g",
  "base_stock": 50,
  "pn_counter": {
    "increments": {},
    "decrements": { "counter_a": 7, "counter_b": 3 }
  },
  "stock": 40,
  "price": 10,
  "shelf_location": "Aisle 2",
  "vector_clock": { "counter_a": 2, "counter_b": 1 },
  "field_last_writer": { "price": "counter_a", "shelf_location": "counter_a" },
  "conflict_status": "none",
  "updated_at": "2026-09-17T10:05:00Z"
}
```

### `inventory_records` — a same-field conflict awaiting review

```json
{
  "pk": "SHOP#demo-shop#ITEM#parle-g",
  "sk": "CURRENT",
  "name": "Parle-G 100g",
  "price": 10,
  "conflict_status": "needs_review",
  "conflict_candidates": {
    "field": "price",
    "overlap_seconds": 300,
    "values": [
      { "counter_id": "counter_a", "value": 10, "client_timestamp": "2026-09-17T10:04:00Z", "server_timestamp": "2026-09-17T10:09:30Z" },
      { "counter_id": "counter_b", "value": 12, "client_timestamp": "2026-09-17T10:04:05Z", "server_timestamp": "2026-09-17T10:09:32Z" }
    ],
    "bedrock_explanation": "Counter A and Counter B set different prices for this item within seconds of each other while both were offline for about 5 minutes. This is likely two people updating the price independently rather than a data error."
  }
}
```

### `write_dedup` — a processed transaction

```json
{
  "idempotency_key": "b3f1c2a0-9e21-4f3a-9b7e-1234567890ab",
  "item_id": "parle-g",
  "status": "applied",
  "cached_response": { "status": "applied", "conflict": false },
  "ttl": 1758268800
}
```

---

## 7. Capacity Mode and Cost Notes

Use **on-demand capacity mode** for all four tables — hackathon traffic
is spiky and low-volume, and on-demand avoids any need to
provision/tune capacity units, which is time better spent elsewhere in a
10-day window. All four tables sit comfortably inside DynamoDB's
always-free monthly allowance at this scale.

---

## 8. Platform Layer Tables (Tier 2 — see `11-PHASED-SCOPE.md`)

New access patterns these tables serve:

| # | Access pattern |
|---|---|
| AP-8 | Get/list all products for a shop, optionally filtered by category |
| AP-9 | Get/list categories and suppliers for a shop |
| AP-10 | Get a user's profile, role, and shop membership by their Cognito user ID |
| AP-11 | Get an order's line items and total by `order_id` |
| AP-12 | Get a shop's daily sales/revenue rollup for a given date range |
| AP-13 | List notifications sent to a shop, most recent first |

### 8.1 Table: `products`

| Attribute | Type | Notes |
|---|---|---|
| `pk` | String | `SHOP#<shop_id>` |
| `sk` | String | `PRODUCT#<product_id>` |
| `name` | String | |
| `sku` | String | |
| `category_id` | String | |
| `supplier_id` | String | |
| `base_price` | Number | |
| `created_at` / `updated_at` | String (ISO) | |

This is the **catalog** — static product metadata. It's deliberately
separate from `inventory_records` (Section 2), which holds the live,
concurrently-modified stock/price state. Keeping these separate means
the CRDT/vector-clock machinery only applies where it's actually needed
(live, concurrently-edited state), not to simple catalog metadata edits.

**GSI-1 — `CategoryIndex`:** partition key `category_id`, for AP-8's
category-filtered listing.

### 8.2 Table: `categories` and `suppliers`

Simple per-shop lookup tables, same key pattern:
`pk = SHOP#<shop_id>`, `sk = CATEGORY#<category_id>` or
`SUPPLIER#<supplier_id>`. Suppliers additionally carry `lead_time_days`,
used by the reorder-suggestion AI feature.

### 8.3 Table: `shops` and `users`

`shops`: `pk = SHOP#<shop_id>`, holding `name`, `address`,
`owner_user_id`, `created_at`.

`users`: `pk = USER#<cognito_sub>`, holding `name`, `role`
(`owner`/`manager`/`counter_staff`), and `shop_ids` (a list, since a user
could plausibly belong to more than one shop — e.g. an owner with
multiple locations). Serves AP-10 directly by partition key lookup.

### 8.4 Table: `orders`

| Attribute | Type | Notes |
|---|---|---|
| `pk` | String | `SHOP#<shop_id>` |
| `sk` | String | `ORDER#<order_id>` |
| `counter_id` | String | which counter completed the checkout |
| `line_items` | List | `[{ product_id, quantity, unit_price }]` |
| `total_amount` | Number | |
| `status` | String | `completed` \| `refunded` |
| `created_at` | String (ISO) | |

Note: `orders` records the checkout **summary** for receipts and
analytics. The actual stock-affecting writes still go through
`inventory_records`/`audit_log` via the standard transaction pipeline —
this table never becomes a second source of truth for stock state.

### 8.5 Table: `daily_analytics`

**This table is a hard prerequisite for the reorder-alerts feature**
(`02-ARCHITECTURE.md` Section 10.7) — that feature reads directly from
here and cannot be built before this table exists and is populated.

| Attribute | Type | Notes |
|---|---|---|
| `pk` | String | `SHOP#<shop_id>#ITEM#<item_id>` |
| `sk` | String | `DATE#<yyyy-mm-dd>` |
| `units_sold` | Number | |
| `revenue` | Number | |
| `conflict_count` | Number | |

Serves AP-12 with a direct range query on `sk` between two dates.
Computed entirely from `audit_log`; can be safely recomputed/backfilled
at any time since it's a derived rollup, not a source of truth.

### 8.6 Table: `notifications_log`

| Attribute | Type | Notes |
|---|---|---|
| `pk` | String | `SHOP#<shop_id>` |
| `sk` | String | `<ISO timestamp>#<notification_id>` |
| `type` | String | `low_stock` \| `conflict_pending` \| `daily_summary` |
| `channel` | String | `email` \| `sms` |
| `details` | Map | |

Serves AP-13 with a direct chronological query, same pattern as
`audit_log`.
