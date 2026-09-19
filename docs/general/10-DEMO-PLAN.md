# StockSync — Demo Plan

The guiding principle: **cause the hard problem live, don't describe it.**
A judge watching a claim is unconvinced; a judge watching a conflict
happen and then get resolved correctly, with arithmetic they can check
themselves, is convinced.

---

## 1. The Setup

- Sign in to the same shop's account in two browser windows side by side —
  the shared identity now comes from Cognito, not a URL query param — then
  pick "Counter A" in one and "Counter B" in the other from the post-login
  counter picker. Both should land on the same seeded item (e.g. "Parle-G
  100g, Stock: 50").
- A third panel/tab ready to switch to: the audit log for that item.
- Each window's in-UI network toggle visible and ready to click — not a
  DevTools trick, a real control built into the product.

---

## 2. Script (target: 2:45–3:00)

**[0:00–0:20] The problem, fast**
> "Small shops with more than one billing counter share one internet
> connection. When it drops and two counters sell the same item, most
> systems let whoever reconnects last silently overwrite the other's
> sales. StockSync makes that mathematically impossible."

**[0:20–1:00] Cause the conflict**
- Click both counters' offline toggles on screen — visibly, deliberately.
- Counter A sells 5 units, then 2 more.
- Counter B sells 3 units.
- Narrate: "Both counters are offline right now, both selling the same
  item, neither can see the other."

**[1:00–1:45] Reconnect, verify with arithmetic**
- Click both counters back online.
- Show the stock count land on **40** on both screens.
- Say the arithmetic out loud: "50, minus 5, minus 2, minus 3 — 40. Every
  sale counted, nothing lost, regardless of which counter reconnected
  first."
- Cut to the audit log: three individual sales, correctly attributed to
  the right counter, in the right order.

**[1:45–2:15] The harder case — same-field conflict**
- Both counters go offline again. Counter A sets the price to ₹10,
  Counter B sets it to ₹12.
- Reconnect. Show the conflict banner: both values shown, how long both
  devices were concurrently offline, plus the Bedrock-generated
  plain-language explanation of the discrepancy.
- Narrate: "When it genuinely can't tell which edit should win, it
  doesn't guess — it asks, tells you how long both were offline for
  context, and explains why."

**[optional bonus beat, if time allows — Chaos demo (Phase 17/15a)]**
- Submit a sale via the UI, then immediately set `conflictResolverFn`'s
  reserved concurrency to 0 in the AWS Console for a few seconds.
- Narrate: "the function that resolves this write just got cut off —
  watch what happens" — then restore concurrency and show the
  transaction complete correctly, exactly once, no duplication.
- **Timing notes: TBD** — this needs rehearsal against the real deployed
  stack (not yet done as of this writing; blocked on AWS deploy) before
  it's trusted live. Rehearse it 5x per the same bar as every other
  demo-critical beat before using it in the final recording; cut it
  without hesitation if it's not solid.

**[2:15–2:40] The architecture, fast**
- One diagram, ~20 seconds: "Every write is deduplicated, ordered
  per-item through SQS FIFO, resolved with a CRDT counter, and committed
  atomically in DynamoDB — every one of these is load-bearing; remove any
  one and the guarantee breaks."

**[2:40–3:00] Close**
> "This isn't a point-of-sale app — it's the sync engine underneath one.
> Any offline-tolerant system that shares a number across devices has
> this exact problem, and most solve it badly or not at all. And because
> that audit trail is a real, tamper-evident record of a shop's actual
> sales — something most small Indian retailers don't have today — it's
> a more honest starting point for credit access than what most lenders
> can see about a shop right now."

---

## 3. Rehearsal Checklist

- [ ] The automated Playwright test (`08-TESTING-STRATEGY.md` Section
      4.1) passes 10 times consecutively before you trust the manual
      demo.
- [ ] Manually run the full script 5 times back to back using the reset
      script (`scripts/reset-demo.ts`) between runs, with zero manual
      database fixes needed.
- [ ] Time it — if over 3:00, trim the architecture slide first, never
      the live conflict demonstration.
- [ ] Watch the recording cold, as if you'd never seen the project —
      note anything unclear without narration filling the gap.
- [ ] Have a screen-recorded backup take ready in case the live browser
      demo is flaky on the actual recording day.

---

## 4. What Not to Do

- Don't narrate the UI's polish — it's intentionally minimal; if you
  catch yourself explaining the interface instead of the sync mechanism,
  you're demoing the wrong thing.
- Don't explain vector clocks or PN-counters in depth in the video —
  that's what the README and doc set are for. The video shows the
  *effect*; the docs explain the *mechanism* for judges who want to go
  deeper.
- Don't skip the same-field conflict case — the field-merge case alone
  looks almost too easy, and the same-field case is what proves you
  handled the genuinely hard 20%, not just the easy 80%.
