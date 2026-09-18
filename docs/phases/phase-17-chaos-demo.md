# Phase 17: Live Chaos-Engineering Demo

## Header

**Goal:** Prove, on camera, that the idempotency and SQS-redelivery
guarantees already built in Phase 4/5 hold under a real AWS
infrastructure failure — by deliberately breaking the system
mid-transaction during the recorded demo and showing it recover.

**Preconditions:** Phase 16 complete. Deploy live and rehearsed.

**Implements:** No new code — this exercises FR-2 (idempotency) and
`02-ARCHITECTURE.md` §9's failure-mode table as live evidence.

---

## Task Breakdown

1. **Fault-injection mechanism:** set `conflictResolverFn`'s reserved
   concurrency to 0 in the AWS Console for a few seconds right after
   submitting a transaction — no code change, fully reversible.
2. **Script the sequence:**
   - Submit a sale via the UI.
   - Immediately set reserved concurrency to 0.
   - Narrate what's happening.
   - After a few seconds, restore concurrency.
   - Show the transaction complete correctly — exactly once, no duplication.
3. **Rehearse the exact timing** before trusting it live.
4. **Screen-record a fallback take** of a successful run.

## Real-World Engineering Concerns

- **If this doesn't recover cleanly, that's a real regression** worth
  investigating immediately, not a missing feature.
- **Don't build a fancier chaos tool.** Reserved-concurrency-to-zero is
  boring and reliable — that's the point.

## Definition of Done

- [ ] The sequence in step 2 succeeds 5 times in a row.
- [ ] A fallback recording exists.
- [ ] Added to `10-DEMO-PLAN.md` as an explicit beat with timing notes.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Throttle window timing looks unconvincing on camera | Iterate during rehearsal, not a technical fix |
| Forgetting to restore concurrency after recording | Add to pre/post-recording checklists explicitly |

## Time Budget

Under half a day — mostly rehearsal, not build.

## Handoff

Phase 18 can begin once this is rehearsed and confirmed.
