# Final Feature Selection — Stop Adding, Start Executing

Every feature proposed across this entire project, in one table, with an
honest recommendation for each. Read the judging criteria at the bottom
of this doc before you read anything else — they're the actual argument
for why this document exists.

---

## The judging criteria, which is the entire argument for this document

> "A small problem solved well beats a big one solved vaguely."
> "Does it work? Not perfect, not polished. Working. One feature that
> runs beats five that almost do."

You pasted these yourself. They are not a suggestion to build more —
they are an explicit warning against it. Every feature below that isn't
in the "Build" column is a feature that, if half-finished, actively
costs you points under criterion 4, not just a missed opportunity under
criterion 1.

---

## Everything proposed, in one place

| Feature | AWS services | Best judging fit | Cost | Decision |
|---|---|---|---|---|
| **Offline sync engine (CRDT, vector clocks, PN-Counter)** | Lambda, DynamoDB+Streams, SQS FIFO, API Gateway | Built on AWS, Execution | — (done) | **Already built** |
| **Bedrock price-conflict explainer** | Bedrock | Idea and Impact, Built on AWS | — (done) | **Already built** |
| **13b. CRDT/vector-clock explainer view** | none (reads existing data) | Learning, Execution, Best UI | Low | **Build — do this first** |
| **15a. Live chaos-engineering demo** | Lambda (reserved concurrency toggle only) | Learning, Execution | Near-zero (no new code) | **Build — do this second** |
| **15b. Expiry-date tracking** | none (reuses existing engine) | Idea and Impact, Execution | Near-zero | **Build — do this third** |
| **13a / 2.9. Barcode/QR quick-entry** | none | Idea and Impact, Best UI | Low-medium | **Build if 1–3 land with time to spare** |
| **2.1 + 2.2. CRUD + checkout** | Lambda, DynamoDB | Idea and Impact ("looks like a real product") | Medium | **Build if 1–4 land with time to spare — this is what actually fixes "the app looks simple"** |
| **13c. Trust-score dashboard** | Lambda, DynamoDB (needs 2.4's rollup) | Idea and Impact | Medium (bundled with 2.4) | Build only alongside 2.4, not standalone |
| **14d. Bankable-ledger framing** | none — narrative only | Idea and Impact | Under an hour | **Do this regardless — it's free** |
| **15d. Cooperative purchasing signal** | none — narrative only | Idea and Impact | Under an hour | **Name in README regardless — it's free** |
| 2.3. Cognito auth | Cognito | Built on AWS | Medium-high | Name in README as roadmap |
| 2.4. Analytics dashboard (standalone) | Lambda, DynamoDB, EventBridge | Idea and Impact | Medium | Only if bundling with 13c above |
| 2.5 / 14c. Notifications (SNS/SES or WhatsApp) | SNS/SES or End User Messaging Social | Idea and Impact | Medium (+ Meta approval lead time for WhatsApp) | Name in README as roadmap |
| 2.6. NL shop-query assistant | Bedrock | Built on AWS | Medium-high | Name in README as roadmap |
| 2.7. Reorder alerts | Bedrock (needs 2.4's data) | Idea and Impact | Medium-high, hard-dependent on 2.4 | Name in README as roadmap |
| 2.8. Voice transaction entry | Transcribe, Bedrock | Idea and Impact, Built on AWS | High | Name in README as roadmap |
| 14a. QR sneakernet sync | none new | Learning, Execution | High (1–1.5 days) | Name in README as roadmap — genuinely great idea, genuinely too much new engineering for now |
| 14b. CV shelf reconciliation | Rekognition/Bedrock vision | Idea and Impact | High, least predictable | Name in README as roadmap |
| 15c. Icon-only low-literacy UI | none | Idea and Impact | Medium, needs real usability testing to actually claim done | Name in README as roadmap |
| 2.10. Multi-environment CDK | CDK | Built on AWS | Medium | Name in README as roadmap |

---

## The actual plan, in order, starting from where you are right now

1. **Confirm Phase 9.5's deploy is live and rehearsed.** Nothing below
   this line matters if this isn't true yet.
2. **Build 13b (CRDT explainer).** Cheapest possible win for making your
   hardest engineering visible.
3. **Build 15a (chaos demo).** Costs you a rehearsal, not a build.
4. **Build 15b (expiry tracking).** Proves the engine generalizes, at
   near-zero cost.
5. **Write the two free narrative additions (14d, 15d)** into the README
   and demo close. Do this the same day as step 1 — there's no reason to
   wait.
6. **Stop and reassess time remaining.** If you have real days left:
   build 13a (barcode/QR), then 2.1+2.2 (CRUD+checkout) — this second one
   specifically is what answers your complaint that "the app looks
   simple." If you have less than a day left: stop here. Steps 1–5 are
   already a genuinely strong, differentiated, working submission.
7. **Everything else in the table becomes one line each in your README's
   "where this goes next" section.** Not built. Named. That's not a
   failure — naming real, well-reasoned future scope is explicitly
   rewarded under "Idea and Impact," and it costs you nothing.

---

## Why "the app looks simple" isn't actually the problem you think it is

You said the app looks simple and you want to add features to fix that.
Be precise about which problem you're actually solving: **CRUD +
checkout (step 6) makes it look like a complete product. 13b/15a/15b make
it look like serious engineering.** These are different kinds of
"impressive," and they serve different judging criteria. A judge scoring
"Idea and Impact" cares about the first kind. A judge scoring "Built on
AWS," "Learning," and reading your writeup carefully cares about the
second kind. You don't need ten features to have both — you need three
or four of the *right* features, chosen for which judging line they
actually move, which is exactly what the table above is for.

---

## The one thing to actually do next

Don't ask for more ideas. Open `phase-9.5-deployment-runbook.md` (or
confirm it's already done), then start on 13b. Come back when that's
built and tested, not before.
