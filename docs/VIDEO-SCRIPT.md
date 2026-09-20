# StockSync — 3-Minute Submission Video Script

A second-by-second script for the required demo video. The submission
form asks for ≤3 minutes covering four things — this script is built so
each one gets a dedicated, timestamped beat instead of being squeezed in:

1. About the project
2. Tech stack and architecture
3. How you used AWS
4. Learning and growth

**Total runtime budget: 180 seconds.** Each beat below has an exact
start/end timestamp, the literal words to say (read it near-verbatim —
it's paced to fit), and exactly what should be on screen. Rehearse with a
stopwatch; if a beat runs long, trim adjectives, never cut a beat
entirely — each one exists to hit one of the four required points.

Pre-requisite: read [`docs/general/10-DEMO-PLAN.md`](general/10-DEMO-PLAN.md)
first — its rehearsal checklist (10 consecutive Playwright passes, 5
consecutive manual runs) applies before you record this for real.

---

## Setup, before you hit record

- Two browser windows side by side, signed into **the same shop**
  (Cognito account), one as "Counter A", one as "Counter B" — both
  showing the same seeded item, **Parle-G 100g, Stock: 50**. Shop
  identity comes from sign-in now, not a URL param — see the demo plan's
  §1 Setup for the exact flow.
- A third tab ready on the **audit log** for that item.
- A fourth tab ready on the **Dashboard** page.
- Each counter window's in-UI offline toggle visible and reachable
  without scrolling.
- Live URL: `https://main.d18ash44o1uc8d.amplifyapp.com`

---

## 0:00 – 0:15 — About the project

**Show:** The hero page (`https://main.d18ash44o1uc8d.amplifyapp.com`),
then cut to the two counter windows side by side.

**Say:**
> "Small shops running two billing counters share one shaky connection.
> When it drops and both sell the same item, most systems let whoever
> reconnects last silently overwrite the other's sales. StockSync makes
> that mathematically impossible."

---

## 0:15 – 0:50 — Cause the conflict, live

**Show:** Click both counters' offline toggles, on screen, deliberately.
Counter A sells 5 units, then 2 more. Counter B sells 3 units. Point at
each stock number changing independently.

**Say:**
> "Both counters go offline — right now, live. Counter A sells 5, then 2
> more. Counter B sells 3. Neither can see the other's sale. This is the
> exact case most offline-sync features never actually handle."

---

## 0:50 – 1:25 — Reconnect and prove it with arithmetic

**Show:** Click both counters back online. Let the stock number land on
**40** on both screens. Cut to the audit log tab: three sales, correctly
attributed, in order.

**Say:**
> "Reconnect both. Watch the number: 50, minus 5, minus 2, minus 3 — 40,
> on both screens, regardless of which counter reconnected first. Every
> sale counted, nothing silently lost. The audit log shows all three
> sales, correctly attributed to the right counter."

---

## 1:25 – 1:50 — The hard case: same-field conflict + AI

**Show:** Both counters offline again. Counter A sets price to ₹10,
Counter B sets it to ₹12. Reconnect. Show the conflict banner with both
values and the Bedrock-generated explanation.

**Say:**
> "Here's the case that can't be auto-merged: both counters set a
> different price while offline. StockSync never guesses — it flags it
> for a human, shows both values, and calls Amazon Bedrock to explain the
> disagreement in plain language. The AI explains; it never decides."

---

## 1:50 – 2:25 — Tech stack and architecture

**Show:** Cut to a static view of the architecture diagram (screen-share
the README's Mermaid diagram, or a slide built from it) while narrating.
Point at each service as it's named.

**Say:**
> "Under the hood: a React client with an IndexedDB offline queue talks
> to API Gateway — REST for writes, WebSocket for live push. Lambda
> write-intake checks for duplicates and enqueues into SQS FIFO, grouped
> by item ID, not the sending counter, so every write touching one item
> stays strictly ordered. A second Lambda, conflict-resolver, merges with
> vector clocks and a PN-Counter CRDT, then commits the record, its audit
> entry, and its idempotency claim atomically via TransactWriteItems."

---

## 2:25 – 2:50 — How AWS powers the rest of the product

**Show:** Quick cuts: Cognito sign-in/sign-up screen → Dashboard page →
a low-stock email notification (or the SES console showing it sent) →
CloudWatch metrics dashboard.

**Say:**
> "Beyond the core engine: Amazon Cognito handles real multi-tenant
> auth — owner, manager, counter-staff roles, every route verifying a
> signed token. DynamoDB Streams also feeds an Amazon SES email alert
> when stock runs low, and Amazon CloudWatch tracks conflict rate in
> production. The whole stack is defined as code with AWS CDK and
> deployed to a real AWS account."

---

## 2:50 – 3:00 — Learning and growth, and the close

**Show:** Cut back to the hero page or a StockSync logo card as the final
frame.

**Say:**
> "Building this taught me CRDTs aren't academic — they make 'offline
> and correct' true at once. This is the sync engine underneath a
> point-of-sale app, live on AWS today."

---

## Timing cheat-sheet

| Beat | Start | End | Duration | Required point covered |
|---|---|---|---|---|
| About the project | 0:00 | 0:15 | 15s | ① About the project |
| Cause the conflict | 0:15 | 0:50 | 35s | ① / proof of correctness |
| Reconnect + arithmetic | 0:50 | 1:25 | 35s | ① / proof of correctness |
| Same-field conflict + AI | 1:25 | 1:50 | 25s | ③ AWS usage (Bedrock) |
| Tech stack & architecture | 1:50 | 2:25 | 35s | ② Tech stack and architecture |
| AWS services tour | 2:25 | 2:50 | 25s | ③ How you used AWS |
| Learning & growth + close | 2:50 | 3:00 | 10s | ④ Learning and growth |

**Total: 180s / 3:00 exactly** — no slack, so rehearse each beat's timing
individually before doing a full run. If you're consistently running
long, the safest beat to trim is "Tech stack & architecture" (read it
slightly faster) — never cut the live conflict demo, since that's the
single most convincing thing a judge can watch happen.

## If you're short on rehearsal time

The absolute minimum viable cut, if something goes wrong live and you
need a fallback: beats 1–3 (0:00–1:25) prove the core claim on their own
and satisfy "about the project." Beats 5–6 (tech stack + AWS usage) are
required by the form, so don't skip them even under time pressure — trim
their word count instead, using the bullet nouns (Cognito, SES,
CloudWatch, CDK) as a minimum rather than the full sentences above.
