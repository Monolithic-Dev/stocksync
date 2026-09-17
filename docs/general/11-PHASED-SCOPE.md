# StockSync — Phased Scope: Core vs. Platform vs. Roadmap

This document exists to resolve a real tension directly, rather than
pretend it doesn't exist: you want this to read as a big, complete,
production-grade platform, and you have 10 days. Both are achievable
together only if it's explicit, at all times, which features are
load-bearing for the demo and which are additive breadth. This doc is
that boundary.

**The rule that governs everything below:** nothing in Tier 2 begins
until Tier 1's Day 7 exit criterion (the core conflict scenario passing
10/10 rehearsals — see `09-BUILD-PLAN.md`) is actually met, not "almost
met." If Day 7 arrives and Tier 1 isn't solid, every remaining day goes
to Tier 1, full stop, regardless of how tempting a Tier 2 feature is.

---

## Tier 1 — The Core Engine (non-negotiable, this is what you're actually judged on)

This is everything in the original scope: offline-first sync, PN-Counter
stock resolution, field-level merge, mandatory conflict flagging, atomic
writes, the audit trail (timeline-style, for the "Best UI" claim), and
the price-conflict Bedrock assist (including `overlap_seconds` context).

**Voice entry, Bedrock reorder alerts, and client-side barcode/QR were
briefly promoted into this tier and have been reverted back to Tier 2**
(see the table below) — reorder alerts in particular cannot actually be
built before Tier 2's analytics pipeline exists, since it reads directly
from a table that pipeline creates. The timeline-style audit UI and the
`overlap_seconds` context stay in Tier 1 because neither adds real risk:
no new AWS service, no new data dependency, no new client capability
that could visibly fail on camera.

This must be flawless. Nothing in Tier 2 or 3 is worth a single hour of Tier 1's
polish or rehearsal time.

---

## Tier 2 — Platform Layer (build these, in this order, only once Tier 1 is solid)

This is the expansion that makes StockSync look like a real, complete
product rather than a single clever mechanism — and it's designed so
that **every new feature is built on top of the sync engine, not next to
it**, directly addressing your concern about not wanting offline sync to
be a bolted-on toggle. Concretely: completing a checkout order doesn't
call some separate "create order" write path — it submits a batch of
transactions through the exact same `POST /transactions` pipeline that
already handles conflict resolution. The sync engine is the substrate
every feature runs on, not a demo appendage.

| Priority | Feature | Why it's in Tier 2, not Tier 3 |
|---|---|---|
| 2.1 | Full CRUD: products, categories, suppliers, shops | Straightforward to build once the data model exists; makes the app feel like a real managed system, not a fixed demo with hardcoded items |
| 2.2 | Multi-item checkout / order flow | Directly exercises the sync engine at higher realism (a checkout is just a batch of sale transactions) — reinforces rather than dilutes the core story |
| 2.3 | Cognito-based auth with roles (owner / manager / counter staff) | Turns "hardcoded Counter A / Counter B" into a real multi-tenant, multi-user system — meaningful for "Idea and Impact" and "Built on AWS" both |
| 2.4 | Daily analytics rollup + dashboard | Gives the owner persona a reason to exist beyond conflict resolution; cheap to build as a scheduled Lambda over existing `audit_log` data |
| 2.5 | Low-stock and conflict notifications (SNS/SES) | Small addition, high perceived-completeness payoff; also gives you a second, distinct AWS service story to tell in the demo |
| 2.6 | AI assistant: natural-language querying of shop data | A genuinely new AI use case (not just conflict explanation) — "how much did Counter B sell today" answered in plain language |
| 2.7 | Bedrock reorder alerts | **Hard prerequisite on 2.4** — reads `daily_analytics` and `suppliers.lead_time_days` directly; cannot be built before those exist, not just risky to build early |
| 2.8 | Voice-based transaction entry (Amazon Transcribe + Bedrock) | Genuinely valuable UX for counter staff mid-rush, but a real new integration (audio capture, mic permissions, transcription reliability) — no data dependency on anything above, but real standalone risk |
| 2.9 | Client-side barcode/QR quick-entry | No new AWS service, no data dependency — but a new client capability (camera permissions, decode reliability) with its own real integration risk |
| 2.10 | Multi-environment CDK stacks (dev/staging/prod) + CI/CD gate | The single highest-leverage "this looks like a real engineering org" signal for the least implementation risk |

**Build these in the listed order.** Each one is scoped to be addable
independently — if you run out of days at 2.5, you stop there with a
coherent, still-impressive product, not a pile of half-finished features.

---

## Tier 3 — Roadmap / Vision (described, not built)

State these explicitly in your README and the demo's closing seconds as
"where this goes next" — real product vision costs you nothing to
articulate and materially helps "Idea and Impact," but attempting to
build any of it in 10 days would cannibalize Tier 1 or 2 time for no
judging benefit:

- Full multi-tenant SaaS billing (subscription tiers, usage-based pricing)
- A public marketplace connecting shops to suppliers directly through the
  platform
- A trained (not prompted) demand-forecasting model, once enough real
  transaction history exists to train on
- Native mobile apps for counters (the web client is deliberately
  sufficient for the demo)
- GST-compliant invoicing and real payment processing

---

## How to Talk About This in the Submission

Say explicitly, in the README and in the demo's closing line: *"The sync
engine is the core; everything else — checkout, multi-shop management,
analytics, the AI assistant — is built on top of it, not alongside it."*
This one sentence does real work: it tells a judge you made a deliberate
architectural choice (substrate vs. feature), not that you built a pile
of disconnected features to look busy.
