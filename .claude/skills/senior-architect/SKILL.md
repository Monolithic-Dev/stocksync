---
name: "senior-architect"
description: Architecture review for StockSync's correctness-critical core — vector clocks, PN-Counter CRDT merge, SQS FIFO ordering, and atomic multi-table DynamoDB writes. Use when adding or modifying anything in packages/core, when a new Lambda needs to write to more than one table, when a new field or data type is added to a synced record, when reviewing a PR that touches conflict resolution, or when someone asks "does this need a vector clock", "is this safe to merge concurrently", "what happens if two counters write this at once", or "should this be atomic". Also use before introducing any new SQS queue, DynamoDB Streams consumer, or WebSocket push path.
---

# Senior Architect — StockSync

This project's entire pitch rests on one guarantee: **two clients can write
the same record while both are offline, in any order, for any duration, and
the system still produces a mathematically correct, non-lossy result.**
Every architectural decision in this skill exists to protect that guarantee.
This is not generic distributed-systems advice — it's the specific set of
questions that have already caught real bugs in this codebase (see the
"already caught" list below), and the questions that will catch the next one.

## Core guidance

### The four questions to ask before any change touches synced data

1. **Can two different clients write this field/record while both are
   offline?** If no, plain optimistic locking or last-write-wins is fine —
   don't reach for a vector clock on data that's never genuinely concurrent
   (e.g. a per-counter local UI preference). If yes, continue.
2. **Is the data count-like (something that only needs to go up or down),
   or field-like (a value that gets replaced)?** Count-like → model it as a
   PN-Counter, the same way `pnCounter.ts` does for stock. Field-like →
   field-level merge if the field is independent of others, or a
   `needs_review` flag if two writers can plausibly touch the exact same
   field with different values. Never invent a third resolution strategy
   without writing down, in the PR description, why LWW/field-merge/PN-Counter
   don't fit.
3. **Does this write need to land in more than one table together?**
   (e.g. a record update that must also produce an audit log entry). If yes,
   it goes through `TransactWriteItems`, not sequential calls — a partial
   write here is a data-integrity bug, not a cosmetic inconsistency.
4. **Does this introduce a new SQS message or Streams event?** If so, its
   `MessageGroupId` must be the affected *resource's* id, never the sending
   client's id. This is the single most repeated correctness bug in this
   project's history (see below) — grouping by sender lets two clients race
   on the same resource, which defeats the entire ordering guarantee.

### Already caught in this project — don't reintroduce these

- **Direct write vs. Streams race condition:** an earlier draft wrote
  unresolved state directly to `records` before Streams triggered
  resolution, creating a window where a concurrent read or write saw
  half-merged state. Fixed by resolving fully before any write lands, via
  the FIFO-then-resolver pipeline.
- **SQS grouped by client, not resource:** an earlier draft used
  `MessageGroupId = counter_id`. Two counters editing the same item then
  raced each other in parallel Lambda invocations. Fixed by grouping on the
  affected record's id.
- **Non-atomic cross-table writes:** `records`, `audit_log`, and
  `write_dedup` were originally three separate `PutItem`/`UpdateItem` calls.
  A crash mid-sequence could leave the record updated but the audit trail
  silently missing that fact. Fixed with `TransactWriteItems`.
- **G-Counter instead of PN-Counter:** stock only supported increments,
  which can't represent a sale (a decrement). Fixed by splitting into two
  internal counters (increments, decrements) per the PN-Counter design.

### Worked example — adding a new synced field

Say a future iteration adds `supplierNote` (free text, editable by any
counter) to an inventory item. Walk the four questions:
1. Yes, two counters can edit it offline.
2. Field-like, not count-like.
3. It's part of the existing `inventory_records` transaction, so no new
   table involved — no new `TransactWriteItems` needed.
4. No new queue — it rides the existing per-item FIFO group.

Conclusion: this is a **field-level merge** case. If two counters write
different notes concurrently, that's a genuine same-field conflict — flag
`needs_review`, don't average or concatenate the two notes silently.

## Watch out for

- **Adding a resolution strategy nobody asked for.** If a PR introduces a
  fourth merge strategy beyond LWW/field-merge/PN-Counter, that's a signal
  the data model itself might be wrong for this domain — challenge it before
  reviewing the code.
- **A "quick fix" that writes directly to `inventory_records` bypassing the
  resolver Lambda.** Any code path that updates a synced record outside the
  FIFO → resolver → TransactWriteItems pipeline reintroduces exactly the
  race conditions already fixed once.
- **Property tests that only check one operation order.** A commutativity
  test that only tries `[a, b]` and never `[b, a]` (or 3+ clients) isn't
  actually testing the guarantee — see `senior-qa` for the property-based
  testing standard this project holds itself to.
- **Bedrock output silently becoming the resolution.** The AI explanation
  for a `needs_review` conflict is advisory context for a human, never the
  thing that picks the value — see `senior-prompt-engineer` for the
  guardrail this project enforces here.
- **Treating `packages/core` as a place for AWS SDK calls.** If a PR adds
  an `aws-sdk` import to `packages/core`, that's an architecture violation —
  this package must stay framework-free and testable without any AWS
  resource, by design (see `senior-fullstack`'s folder-structure doc for why).

## Hard questions to insist on before proceeding

- **"What's the actual demo scenario this change needs to survive?"** If a
  change can't be stated as "client A does X, client B does Y, both
  offline, reconnect in either order, result is Z" — don't merge it into
  the correctness-critical path until it can be. Vague confidence that
  "it should work" is exactly what the property-based tests exist to
  replace with proof.

## Hand off to

- **senior-qa** — before merging anything touching `packages/core` or a
  Lambda handler in the write pipeline, confirm the property-based test
  suite covers the new behavior, not just an example-based happy path.
- **senior-prompt-engineer** — if a change introduces or modifies a Bedrock
  call anywhere near conflict resolution, confirm it stays advisory-only.
- **senior-devops** — once a schema or queue-grouping change is approved
  here, it needs a corresponding CDK construct update (`cdk_scaffolder.py`'s
  `sync-engine` module) and a `cdk diff` review before deploy.
