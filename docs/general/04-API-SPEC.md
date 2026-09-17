# StockSync — API Specification

All endpoints require an `x-api-key` header (hackathon-scoped auth — see
`02-ARCHITECTURE.md` Section 7 for why this is sufficient for this
build).

---

## 1. REST API

### `POST /transactions`

Submit one or more sale/restock/field-update transactions.

**Request:**
```json
{
  "shop_id": "demo-shop",
  "counter_id": "counter_a",
  "transactions": [
    {
      "idempotency_key": "b3f1c2a0-9e21-4f3a-9b7e-1234567890ab",
      "item_id": "parle-g",
      "type": "sale",
      "quantity": 5,
      "client_vector_clock": { "counter_a": 2, "counter_b": 1 },
      "client_timestamp": "2026-09-17T10:04:00Z"
    },
    {
      "idempotency_key": "c4a2d3b1-...",
      "item_id": "parle-g",
      "type": "field_update",
      "field": "price",
      "value": 10,
      "client_vector_clock": { "counter_a": 3, "counter_b": 1 },
      "client_timestamp": "2026-09-17T10:04:01Z"
    }
  ]
}
```

`type` is one of: `sale` (decrement), `restock` (increment),
`field_update` (any non-stock field).

**Response (200):**
```json
{
  "results": [
    { "idempotency_key": "b3f1c2a0-...", "status": "applied", "conflict": false },
    { "idempotency_key": "c4a2d3b1-...", "status": "needs_review", "conflict": true }
  ]
}
```

`status` values: `applied`, `duplicate`, `conflict_resolved`,
`needs_review`.

---

### `GET /sync?shop_id=X&counter_id=Y`

Called on reconnect to fetch the current, fully-reconciled state of every
item, plus anything that changed while this counter was offline.

**Response (200):**
```json
{
  "items": [
    {
      "item_id": "parle-g",
      "name": "Parle-G 100g",
      "stock": 40,
      "price": 10,
      "shelf_location": "Aisle 2",
      "field_last_writer": { "price": "counter_a", "shelf_location": "counter_a" },
      "conflict_status": "none"
    }
  ]
}
```

---

### `GET /audit/{item_id}?shop_id=X`

Returns the full chronological history for an item — powers the audit
trail screen used in the demo.

**Response (200):**
```json
{
  "item_id": "parle-g",
  "history": [
    {
      "timestamp": "2026-09-17T10:04:00Z",
      "counter_id": "counter_a",
      "action": "sale",
      "details": { "quantity": 5, "resulting_stock": 45 }
    },
    {
      "timestamp": "2026-09-17T10:04:05Z",
      "counter_id": "counter_b",
      "action": "sale",
      "details": { "quantity": 3, "resulting_stock": 42 }
    },
    {
      "timestamp": "2026-09-17T10:05:00Z",
      "counter_id": "counter_a",
      "action": "conflict_detected",
      "resolution_strategy": "needs_review",
      "details": { "field": "price", "values": [10, 12] }
    }
  ]
}
```

---

### `GET /conflicts?shop_id=X`

List all items currently `needs_review` for a shop — powers the
conflict-review screen.

**Response (200):**
```json
{
  "conflicts": [
    {
      "item_id": "parle-g",
      "field": "price",
      "values": [
        { "counter_id": "counter_a", "value": 10 },
        { "counter_id": "counter_b", "value": 12 }
      ],
      "bedrock_explanation": "Counter A and Counter B set different prices for this item within seconds of each other while both were offline."
    }
  ]
}
```

---

### `POST /conflicts/{item_id}/resolve`

A human resolves a flagged conflict. This is intentionally a separate,
simple, non-concurrent write — see PRD Section 13's open question for why.

**Request:**
```json
{
  "shop_id": "demo-shop",
  "field": "price",
  "chosen_value": 10,
  "resolved_by": "shop_owner"
}
```

**Response (200):**
```json
{ "item_id": "parle-g", "field": "price", "status": "resolved", "value": 10 }
```

---

## 2. WebSocket API

**Connect:**
`wss://{api-id}.execute-api.{region}.amazonaws.com/prod?shop_id=demo-shop&counter_id=counter_a`

**Server → client, item updated:**
```json
{
  "type": "record_updated",
  "item_id": "parle-g",
  "stock": 40,
  "price": 10,
  "field_last_writer": { "price": "counter_a" }
}
```

**Server → client, conflict needs review:**
```json
{
  "type": "needs_review",
  "item_id": "parle-g",
  "field": "price",
  "overlap_seconds": 300,
  "values": [
    { "counter_id": "counter_a", "value": 10, "client_timestamp": "2026-09-17T10:04:00Z" },
    { "counter_id": "counter_b", "value": 12, "client_timestamp": "2026-09-17T10:04:05Z" }
  ],
  "ai_summary": null
}
```

Note `ai_summary` may arrive as `null` initially and be
followed by a second `needs_review` push once Bedrock's response
returns — the UI must handle both states gracefully (see
`07-EDGE-CASES.md`, AI section). The `overlap_seconds` field shows exactly
how long both devices were offline and editing the same record concurrently,
giving the human decision-maker useful context about how "genuinely conflicted"
the situation really was.

---

## 3. Internal Contract — Bedrock Prompt (used only inside the
conflict-resolver Lambda, never exposed directly to the client)

**Request shape sent to Bedrock (Claude via Bedrock Runtime):**
```json
{
  "system": "You are a plain-language assistant explaining data conflicts in a small shop's inventory system to a shop owner who is not technical. Be concise: 1-2 sentences. Where available, use the overlap_seconds to describe how long both devices were offline simultaneously.",
  "messages": [
    {
      "role": "user",
      "content": "Two shop counters set different prices for the same item while both were offline for 300 seconds (5 minutes). Counter A set it to ₹10, Counter B set it to ₹12. Explain this discrepancy in plain language and suggest what the owner should consider when picking the correct value."
    }
  ]
}
```

**Expected response:** a short, plain-language paragraph, stored verbatim
in `conflict_candidates.bedrock_explanation`.

---

## 4. Error Codes

| Code | Meaning |
|---|---|
| `400 invalid_payload` | Missing required field (`idempotency_key`, `item_id`, `type`) |
| `401 unauthorized` | Missing or invalid `x-api-key` |
| `404 not_found` | Referenced `item_id` or `shop_id` does not exist |
| `409 conflict_already_resolved` | `POST /conflicts/{id}/resolve` called on an item that's no longer `needs_review` (e.g. resolved by someone else already) |
| `500 internal_error` | Unexpected failure — log with full context, don't hide it |

---

## 5. Platform Layer Endpoints (Tier 2 — see `11-PHASED-SCOPE.md`)

All endpoints below require a Cognito-issued JWT (`Authorization: Bearer
<token>`), not the hackathon-simple API key used by the core engine
endpoints above. The token's `shop_id` and `role` claims are checked on
every request.

### 5.1 CRUD — products, categories, suppliers, shops, users

Uniform REST resource pattern, one set shown as the representative
example (categories and suppliers follow the identical shape):

**`GET /products?shop_id=X&category_id=Y`** → list, optionally filtered
**`POST /products`** → create
```json
{ "shop_id": "demo-shop", "name": "Parle-G 100g", "sku": "PG-100", "category_id": "biscuits", "supplier_id": "sup-1", "base_price": 10 }
```
**`PUT /products/{product_id}`** → update
**`DELETE /products/{product_id}`** → delete

Standard responses: `201` on create, `200` on read/update,
`204` on delete, `403` if the token's `shop_id` doesn't match the
resource's shop.

### 5.2 Checkout

**`POST /checkout`**
```json
{
  "shop_id": "demo-shop",
  "counter_id": "counter_a",
  "order_id": "ord-8827",
  "line_items": [
    { "product_id": "parle-g", "quantity": 3, "unit_price": 10 },
    { "product_id": "milk-500ml", "quantity": 2, "unit_price": 25 }
  ]
}
```
Internally, this handler translates each line item into a standard
`sale`-type transaction (see Section 1) and submits them as one batch to
the exact same intake path used by `POST /transactions` — this endpoint
is a thin translation layer, not a parallel write system.

**Response (200):**
```json
{ "order_id": "ord-8827", "total_amount": 80, "status": "completed" }
```

### 5.3 Analytics

**`GET /analytics/daily?shop_id=X&item_id=Y&from=2026-09-01&to=2026-09-17`**
```json
{
  "item_id": "parle-g",
  "rollup": [
    { "date": "2026-09-16", "units_sold": 12, "revenue": 120, "conflict_count": 1 },
    { "date": "2026-09-17", "units_sold": 10, "revenue": 100, "conflict_count": 0 }
  ]
}
```

### 5.4 Notifications

**`GET /notifications?shop_id=X`** → recent notifications, most recent
first (backs a simple in-app notification feed in addition to the
email/SMS delivery).

### 5.5 AI assistant

**`POST /assistant/ask`**
```json
{ "shop_id": "demo-shop", "question": "How much did Counter B sell today?" }
```
**Response (200):**
```json
{
  "answer": "Counter B recorded 3 sales today totaling ₹145, across 2 items.",
  "grounded_in": { "source": "daily_analytics", "date": "2026-09-17" }
}
```
The `grounded_in` field is returned deliberately — it lets the UI show
the user what data the answer is actually based on, reinforcing that
this is retrieval-grounded, not a free-form guess.

### 5.6 AI reorder suggestions

**`POST /assistant/reorder-suggestion`**
```json
{ "shop_id": "demo-shop", "item_id": "parle-g" }
```
**Response (200):**
```json
{
  "item_id": "parle-g",
  "suggestion": "Selling roughly 11 units/day, with your supplier's 3-day lead time, consider reordering by Thursday to avoid running out.",
  "based_on": { "avg_daily_sales": 11, "supplier_lead_time_days": 3, "current_stock": 40 }
}
```

### 5.7 Voice transaction entry

**`POST /transactions/voice`**
```json
{ "shop_id": "demo-shop", "counter_id": "counter_a", "audio_base64": "..." }
```
Internally: Transcribe → Bedrock structuring → validated against the
same schema as `POST /transactions` → submitted through the standard
pipeline. **Response (200):**
```json
{
  "transcript": "sold five packets of parle-g",
  "parsed_transaction": { "item_id": "parle-g", "type": "sale", "quantity": 5 },
  "result": { "status": "applied", "conflict": false }
}
```
