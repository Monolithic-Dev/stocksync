# Two billing counters, one bad connection, and the bug that erases a sale

_Draft for the AWS Builder Center writeup — Best Blog prize eligibility,
AWS First Commit hackathon (Ship It track)._

## The problem I kept seeing

Small shops in India increasingly run more than one billing counter — a
second register during rush hour, or an owner checking stock from their
own phone — sharing a single, often flaky internet connection. The
popular digital-ledger apps market "offline mode" and "multi-device
sync," but dig into what they actually mean and it's the safe case: edit
later, when you're back online, one device at a time. None of them
advertise the case that actually breaks small retail — two devices,
**both offline at the same time, both editing the same shared number**.

That case matters because the naive fix is actively dangerous. If both
counters queue their sales locally and just push a full snapshot on
reconnect, whichever one syncs last wins — and silently erases the
other counter's sales from the record. Nobody notices until the stock
count is wrong and a customer is told an item is in stock when it isn't.

That's not a networking problem. Retries and offline queues already
solve "the connection is unreliable." The actual problem is: two
independent devices changed the same number while neither could see the
other's change, and both need to reconnect to exactly one correct,
shared truth. That's a distributed-systems problem, and it has a
well-known, mathematically correct answer — I just hadn't had a reason
to actually build one before.

## The "aha" — stock isn't a number, it's two counters

My first instinct was to treat stock as a single value protected by
optimistic locking. That falls apart the moment two counters are
concurrently offline: there's no "current version" either of them can
check against, because neither has seen the other's write.

The fix is a **PN-Counter** — a small, specific CRDT (conflict-free
replicated data type). Instead of storing one overwritable number, stock
is derived from two internal, grow-only counters:

```
stock = base_stock + total_increments − total_decrements
```

Restocks add to `increments`, sales add to `decrements`, and each is
itself a map of `{ counter_id: amount }`. Merging two counters' updates
is just addition — which means the merge is **commutative and
associative** by construction. It doesn't matter which counter
reconnects first, or in what order their individual sales arrive; the
final total is the same. I didn't just assert that — I wrote a
property-based test that throws arbitrary orderings of concurrent
increments/decrements at the merge function and checks the total is
identical every time, which is a meaningfully stronger claim than an
example-based unit test with one hand-picked order.

Not every field needs this level of rigor, though — and knowing which
ones do is its own lesson. A price or a shelf-location isn't count-like;
it's replaced, not accumulated. For those, **vector clocks** determine
whether an incoming write cleanly follows the current state or is
genuinely concurrent with it, and disjoint field edits (price vs. shelf
location) merge without conflict automatically. The one case that gets
no automatic resolution is two concurrent writes to the *same* field
with *different* values — a real price disagreement. There, the system
never guesses. It flags the item `needs_review`, keeps both values
visible, and — the part I was most unsure would actually help — calls
**Amazon Bedrock** to generate a short, plain-language explanation of
the disagreement for whoever resolves it. Bedrock is deliberately kept
advisory-only: it explains, it never decides.

## The architecture, and why each piece is load-bearing

```
StockSync Counter (React, IndexedDB offline queue)
        │ POST /transactions               ▲ WSS live push
        ▼                                   │
API Gateway (REST + WebSocket)
        │
        ▼
Lambda: write-intake → SQS FIFO (MessageGroupId = item_id) → Lambda: conflict-resolver
        │ idempotency check                         │ vector-clock / PN-Counter merge
        │                                            │ TransactWriteItems (record + audit + dedup)
        ▼                                            │ Bedrock explanation (non-blocking)
                    Amazon DynamoDB                   ▼
```

The detail that matters most and is easiest to get wrong: the **SQS FIFO
queue's `MessageGroupId` is the inventory item's ID, not the sending
counter's ID.** Group by counter instead, and two counters editing the
same item race each other in parallel Lambda invocations — which
reintroduces the exact bug this project exists to prevent. Grouping by
the affected resource, not the sender, is what guarantees every write
touching one item is processed strictly in order, regardless of how many
counters are concurrently active.

The record update, its audit-log entry, and its idempotency claim commit
together via `TransactWriteItems`, so a crash mid-write can never leave
the audit trail silently missing what actually happened to the stock
count — a real bug I hit and fixed with an earlier draft that used
sequential `PutItem` calls instead.

## A bug a hardening pass actually caught

Late in the build, I ran a dedicated edge-case pass against a 25-item
catalog of concurrency, network, and security scenarios I'd written down
during design. One of them caught a real bug: the write-intake Lambda
processed a client's batch of queued offline transactions with
`Promise.all`, which is fine across *different* items but wrong when two
transactions in the same batch target the *same* item — their
`SendMessageCommand` calls could race each other and land in SQS out of
the client's original order, silently defeating the exact ordering
guarantee the architecture is built around. The fix was small — group a
batch's transactions by item and process each item's transactions
sequentially, while still parallelizing across different items — but
finding it required treating "we handle concurrency correctly" as a
claim to actively try to break, not something to assume once the happy
path demo works.

## What I'd tell someone starting this

If two clients can genuinely edit the same shared value while both are
offline, reach for a CRDT before reaching for locking or last-write-wins
— optimistic concurrency control assumes someone has seen someone else's
current version, and that assumption is exactly what's false in the
offline-and-concurrent case. And build the "break it on purpose" pass
into the plan from day one, not as an afterthought after the demo
works — the bug it caught here was invisible in every rehearsal until I
went looking for it deliberately.

Full source, architecture docs, and the edge-case catalog are in the
repo: see the [README](../README.md) for the complete breakdown and demo
video link.
