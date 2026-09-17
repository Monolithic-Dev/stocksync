# StockSync — Testing Strategy

## 1. The Test Pyramid, Applied to This Project

```
                    ▲
                   ╱ ╲        E2E (Playwright)
                  ╱   ╲       — the core conflict scenario, automated
                 ╱─────╲
                ╱       ╲     Integration (Vitest + DynamoDB Local)
               ╱         ╲    — Lambda handlers against a real table
              ╱───────────╲
             ╱             ╲  Unit + Property-based (Vitest + fast-check)
            ╱               ╲ — packages/core, fast, no AWS dependency
           ╱─────────────────╲
```

Most of your testing effort and confidence should come from the bottom
two layers — they're fast, deterministic, and don't need AWS
infrastructure running. The E2E layer exists specifically to prove the
whole system together, especially for the one scenario the entire demo
depends on.

---

## 2. Unit and Property-Based Tests — `packages/core`

This is where you can and should test exhaustively, because it costs
almost nothing in time (no AWS, no network, runs in milliseconds).

### 2.1 Example-based unit tests

- `vectorClock.test.ts`: dominates() correctly identifies clean applies;
  isConcurrent() correctly identifies genuine conflicts; a clock with an
  unseen counter ID is handled without error (edge case A-5).
- `pnCounter.test.ts`: merging increments and decrements from multiple
  counters produces the documented example from the PRD (start 50, -5,
  -2, -3 → 40) exactly.
- `fieldMerge.test.ts`: disjoint field changes merge without conflict;
  identical concurrent values on the same field are NOT flagged as a
  conflict (edge case B-3); genuinely different concurrent values on the
  same field ARE flagged.
- `conflictResolution.test.ts`: the top-level `resolve()` function
  correctly routes to the right strategy given various input shapes.

### 2.2 Property-based tests (the senior-engineering differentiator)

Use `fast-check` to prove algebraic properties of the PN-counter merge,
not just spot-check specific examples:

- **Commutativity:** for any set of increment/decrement operations from
  any number of counters, applying them in any order produces the same
  final stock value. Generate random sequences of operations, apply them
  in multiple random orders, assert the final result is identical every
  time.
- **Associativity:** grouping the same set of operations differently
  (e.g. merging A+B first, then with C, vs merging B+C first, then with
  A) produces the same result.
- **Idempotency of resolution:** re-running the resolver on an
  already-resolved state with the same inputs produces no further change
  — important because SQS may redeliver a message after a Lambda
  timeout (see architecture doc, Section 9).

This is worth calling out explicitly in your submission writeup — proving
a CRDT's defining mathematical properties with an automated test, rather
than just asserting "it's a CRDT" in prose, is a genuinely strong signal
of engineering rigor to a judge who knows what to look for.

---

## 3. Integration Tests — `apps/api`

Run Lambda handler logic against a real (local) DynamoDB instance —
either DynamoDB Local or LocalStack — rather than mocking the AWS SDK,
since mocking risks testing your mocks instead of your actual logic.

- Write-intake handler: submitting the same idempotency key twice returns
  the cached response and does not create a second `write_dedup` item.
- Conflict-resolver handler: given two DynamoDB items representing a
  concurrent write scenario, the handler produces the correct
  `TransactWriteItems` call and the resulting table state matches
  expectations.
- Dead-letter behavior: a deliberately malformed message results in the
  message appearing in the DLQ, not silently disappearing or blocking
  the queue.
- `overlap_seconds` computation: given two conflicting writes with
  skewed client clocks (one `client_timestamp` earlier than physically
  possible relative to the other), the computed value is clamped to 0
  rather than surfaced as negative (edge case C-6).

---

## 4. End-to-End Tests — Playwright

This is the layer that proves the *whole system*, not just its parts,
and it's the layer most worth investing in given that the entire demo
hinges on one scenario working reliably.

### 4.1 The core scenario, automated

Write a Playwright test that:
1. Opens two independent browser contexts (simulating Counter A and
   Counter B).
2. Uses Playwright's network condition controls to take both offline.
3. Performs the exact PRD US-3 scenario (A sells 5 then 2, B sells 3).
4. Brings both back online.
5. Asserts the final displayed stock count is 40 in both browser
   contexts, and that the audit log (fetched via `GET /audit`) shows all
   three transactions correctly attributed.

Running this automatically, repeatedly, is a far more reliable way to
catch a flaky race condition than manually clicking through the scenario
before each rehearsal — automate this as early as Day 5–6, not as an
afterthought on Day 9.

### 4.2 Additional E2E scenarios worth covering

- The field-merge case (US-4)
- The same-field conflict case, through to the Bedrock explanation
  appearing and a manual resolution being submitted (US-5)
- The malformed-transaction / DLQ case not blocking subsequent valid
  transactions (US-6)

---

## 5. Manual Rehearsal (still necessary, even with automated tests)

Automated tests prove correctness; they don't prove your ability to
narrate and record a clean demo. Once the E2E suite is green, still
follow the rehearsal checklist in `10-DEMO-PLAN.md` — timing, camera
framing, and narration flow are not things a test suite can verify for
you.

---

## 6. What NOT to Spend Time On

- Load testing / performance testing beyond what's needed to feel
  confident the demo won't visibly lag — this is out of scope per the
  PRD's non-functional requirements.
- Testing AWS's own guarantees (e.g. "does DynamoDB actually persist
  data") — test your logic and your usage of AWS services, not AWS
  itself.
- Full browser-compatibility testing — one modern browser (whichever
  you'll record the demo in) is sufficient for a hackathon submission.
