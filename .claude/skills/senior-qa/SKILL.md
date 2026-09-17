---
name: "senior-qa"
description: Testing strategy for StockSync's correctness-critical sync engine — property-based tests for the PN-Counter/vector-clock logic, integration tests against DynamoDB Local, and the Playwright multi-browser-context test that proves the core offline-conflict scenario. Use when writing or reviewing tests for packages/core, when a Lambda handler in the write pipeline changes, before recording the demo video, or when someone asks "how do I test this merge logic", "is this covered", "will this survive the demo", or "how many times should I rerun this". Also use when a bug report describes intermittent/flaky behavior around concurrent writes — that's very likely a real race, not test flakiness.
---

# Senior QA — StockSync

Most of this project's risk isn't "does the happy path work" — it's "does
the concurrent-write guarantee hold under every ordering." That means the
testing approach here is deliberately weighted toward proving algebraic
properties and reproducing a live failure scenario, not just toward
line-coverage percentages. Treat a shaky test here as a real bug lead, not
noise to retry past.

## Core guidance

### The test pyramid, in the order that actually matters for this project

1. **Property-based tests on `packages/core`** — the highest-value layer.
   `fast-check` should generate random sequences of increments/decrements/
   field-writes from an arbitrary number of clients, apply them in multiple
   random orders, and assert the final state is identical every time
   (commutativity) and that merging two independently-built states matches
   applying everything to one (associativity). A test that only checks 2
   fixed clients in 1 fixed order is not testing the guarantee — it's
   testing one anecdote.
2. **Integration tests against DynamoDB Local** — for the write-intake and
   conflict-resolver Lambda handlers, run against a real (local) table
   rather than a mocked AWS SDK. Mocking risks testing the mock's behavior
   instead of the actual DynamoDB semantics (e.g. `TransactWriteItems`
   failure modes) this project depends on.
3. **Playwright E2E, two browser contexts** — the one test that proves the
   whole system, not just its parts. Open two contexts (Counter A, Counter
   B), use Playwright's network condition controls to take both offline,
   perform the PRD's core scenario (A sells 5 then 2, B sells 3, both
   reconnect), and assert the final stock is 40 regardless of reconnect
   order. Run this automatically in CI, not just by hand before a demo.

### The demo-rehearsal gate (this project's most unusual QA practice)

Because the submission video has no live Q&A and no second take once
recorded, treat "10 consecutive successful runs of the core scenario" as a
release gate, not a nice-to-have. If the Playwright test above is green but
a manual run through the actual UI fails even once in 10 tries, that's a
real defect — timing-dependent bugs in this domain often don't show up in
an automated test's exact timing but do show up in a human's slower,
irregular clicking. Don't sign off on "the test passes" alone.

### Worked example — testing a new merge case

Say a new `supplierNote` field is added (see `senior-architect`'s worked
example). The test additions, in order:
1. `packages/core` unit test: two concurrent writes to *different* fields
   (one to `price`, one to `supplierNote`) merge without conflict.
2. `packages/core` unit test: two concurrent writes to `supplierNote` with
   different text values produce `needs_review`, not a silent pick.
3. Integration test: submitting both writes through the actual
   write-intake → resolver pipeline produces the same result as the unit
   test predicts, using real (local) DynamoDB.
4. Only add a new Playwright scenario if this case has a genuinely
   different failure mode than the existing stock-conflict scenario
   already covers — don't duplicate E2E coverage for every field, that's
   what the faster unit/integration layers are for.

## Watch out for

- **A "flaky" test getting a retry annotation instead of an investigation.**
  In this codebase specifically, intermittent test failures around
  concurrent writes are the most likely signal of a real ordering bug, not
  environment noise — the FIFO-grouping and TransactWriteItems patterns
  exist precisely to eliminate that kind of flakiness by construction.
- **Testing the resolver Lambda with a mocked DynamoDB client.** This can
  hide the exact class of bug (partial writes, transaction conflicts) the
  architecture is designed to prevent — use DynamoDB Local for these tests.
- **Property tests with too small a generator range.** `fast-check` with
  `fc.integer({ min: 1, max: 3 })` and 2 clients barely exercises the
  state space; use a wider range and 3+ synthetic client IDs to actually
  stress commutativity.
- **Treating the Playwright test's pass as sufficient before recording.**
  Add the manual, real-browser, real-clicking rehearsal on top of it — see
  the demo-rehearsal gate above.
- **No test at all for the dead-letter-queue path.** A malformed
  transaction should be provably routed to the DLQ without blocking other
  items' processing — this needs its own integration test, not just an
  assumption that SQS's DLQ config "just works."

## Hard questions to insist on before proceeding

- **"Has this property test ever actually failed on the pre-fix version of
  the code?"** If you can't point to a version of the logic that the test
  would have caught, it's not clear the test is checking the right thing —
  temporarily reintroduce a known-bad version (e.g. G-Counter instead of
  PN-Counter) and confirm the test fails, then confirm it passes again on
  the real implementation.

## Hand off to

- **senior-architect** — if a test failure turns out to reveal a genuine
  design gap (a resolution strategy that doesn't fit the data), not just an
  implementation bug, escalate rather than patching around it in the test.
- **senior-prompt-engineer** — for testing Bedrock-dependent behavior
  (the price-conflict explanation, the NL assistant), since those need a
  different testing posture (tolerate the AI call failing/timing out
  gracefully, never assert on exact AI wording).
