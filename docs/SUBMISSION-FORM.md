# StockSync — Hackathon Submission Form (draft answers)

Draft, ready-to-paste answers for the AWS First Commit hackathon submission
form. Review each field, edit anything that doesn't sound like you, fill in
the two fields only you can (video link, team contributions), then paste
into the actual form.

---

## YouTube video demo link *

_TODO — record and paste the link here. Must be published or unlisted, ≤3
minutes, covering: about the project, tech stack and architecture, how you
used AWS, and learning/growth (optional). See
[`docs/general/10-DEMO-PLAN.md`](general/10-DEMO-PLAN.md) for the full
rehearsed script — it's built to hit all four points inside 3 minutes._

---

## What does your project do? *

> What problem does your project solve, and who is it for?

StockSync is an offline-first inventory sync engine for small Indian shops
("kirana stores") that run more than one billing counter on a single,
often-unreliable internet connection — a second register during rush hour,
or an owner checking stock from their own phone.

When the connection drops and two counters sell the same item while both
are offline, most systems either block the sale or let whichever counter
reconnects last silently overwrite the other's numbers — erasing a real
sale from the record. Nobody notices until the stock count is wrong and a
customer is told an item is in stock when it isn't. For thin-margin retail,
that's a recurring, real cost, not an edge case.

StockSync makes that mathematically impossible. Two counters can go
offline, sell the same item, restock it, and change its price — in any
order, for any duration — and when they reconnect, the stock count always
converges to one correct, non-lossy state. Genuine same-field conflicts
(e.g. two different prices set concurrently) are never silently guessed;
they're flagged for a human, with an AI-generated plain-language
explanation to help them decide fast.

It's built for small multi-counter retailers in India today, but the
underlying problem — two offline devices sharing one number that must
reconcile correctly — applies to any offline-tolerant system, not just
point-of-sale.

---

## How did you use AWS in your project? *

> Build it: How have you used AWS open source stack (mention tools name)
> Ship it: How have you used AWS services (mention services name)

**Build it — AWS open-source tooling:**
- **AWS CDK** (TypeScript) — the entire stack (DynamoDB tables, Lambdas,
  API Gateway REST + WebSocket, Cognito, SQS, SES, CloudWatch) is defined
  as code in `infra/cdk`, with unit tests asserting IAM policies never use
  a wildcard resource (with one documented, unavoidable exception —
  `dynamodb:ListStreams`, which AWS has no resource-level IAM scoping for
  at all, confirmed by inspecting the synthesized CloudFormation template).
- **AWS SDK for JavaScript v3** (`@aws-sdk/*`) — every Lambda handler talks
  to DynamoDB, SQS, SES, Cognito, Secrets Manager, and Bedrock through the
  v3 modular clients.
- **aws-sdk-client-mock** — every AWS SDK call in the Lambda test suite is
  mocked at the client level, not the network level, keeping ~150+ tests
  fast and deterministic.

**Ship it — AWS services in production:**
- **AWS Lambda** — every unit of compute: write intake, conflict
  resolution, sync/audit queries, WebSocket connect/disconnect/push,
  Cognito triggers (post-confirmation, staff invite), CRUD/checkout
  handlers, and the SES notification consumer.
- **Amazon DynamoDB** — the system of record (`inventory_records`,
  `write_dedup`, `audit_log`, `ws_connections`, plus the Tier-2 tables:
  `products`, `categories`, `suppliers`, `orders`), with DynamoDB Streams
  driving both real-time WebSocket push and the SES alert pipeline.
- **Amazon SQS (FIFO)** — orders every write touching a given inventory
  item strictly by item ID (not by sending counter), which is the single
  most load-bearing correctness guarantee in the whole system.
- **Amazon API Gateway** — both REST (write/sync/CRUD/checkout endpoints)
  and WebSocket (live push to open counters), with a Cognito JWT authorizer
  on every REST route.
- **Amazon Cognito** — real multi-tenant authentication: self-signup
  creates a shop and its owner; owners invite manager/counter-staff
  accounts; every request's `shop_id` comes from the verified JWT, never
  a client-supplied value.
- **Amazon Bedrock** (Claude Haiku) — generates a plain-language
  explanation of a genuine same-field conflict for the human resolving it
  — strictly advisory, never the thing that decides the value.
- **Amazon SES** — low-stock and conflict-review email alerts to a shop's
  owner, triggered off the same DynamoDB Stream that already powers
  real-time sync.
- **Amazon CloudWatch** — custom `ConflictRate`/`IdempotencyHitRate`
  metrics plus queue-depth dashboards.
- **AWS Secrets Manager** — holds the cross-account Bedrock credentials
  (see the AWS feedback section below for why that workaround exists).
- **AWS Amplify Hosting** — serves the React client.

---

## Blog links

_Publish `docs/BLOG-POST.md` to the AWS Builder Center, then paste the
published link here. The draft is already written — "Two billing
counters, one bad connection, and the bug that erases a sale" — covering
the PN-Counter/vector-clock design decisions, the load-bearing
`MessageGroupId = item_id` detail, and a real concurrency bug an edge-case
hardening pass caught. Nothing left to do but publish it and paste the
link._

### AWS Builder Center "Create an article" form — ready-to-paste fields

**Title** (short, descriptive, unique):

```
Two billing counters, one bad connection, and the bug that erases a sale
```

**Description** (1–2 sentences, doesn't repeat the title):

```
How a hackathon inventory-sync engine uses vector clocks, a PN-Counter
CRDT, and SQS FIFO ordering on AWS to guarantee two offline point-of-sale
counters can never silently overwrite each other's sales — plus a real
concurrency bug a dedicated hardening pass caught before launch.
```

**Tags** (pick the closest 5 available in the dropdown — it's a
controlled vocabulary, so exact matches may not exist):

```
AWS, Serverless, DynamoDB, TypeScript, Distributed Systems
```

**Body:** copy the full contents of [`docs/BLOG-POST.md`](BLOG-POST.md)
(everything after the title line) into the body editor — it's already
written in Markdown, and the editor's toolbar shows a Markdown cheatsheet
that confirms the same syntax (headers, bold, code fences, links) works
as-is. No reformatting needed.

**Cover image (optional, 1200×675px, no text in the image):** this field
needs an actual image file, which I can't generate directly. Use the
prompt below in an image generator (e.g. Midjourney, DALL·E, Stable
Diffusion) and upload the result:

```
A clean, modern tech-editorial illustration for a software engineering
blog post about distributed systems and offline data synchronization.
Two abstract point-of-sale terminal icons on the left and right, each
glowing softly, connected by flowing data-stream lines that merge into a
single glowing node in the center, symbolizing conflict-free merge of
concurrent data. Isometric flat-design style, dark navy background
(#0F1629) with vibrant orange (#FF9900) and indigo (#4F46E5) accent
lighting on the connection lines and nodes. Minimalist, high-contrast,
no text, no logos, no people, no wordmarks — purely abstract
geometric/network shapes. 1200x675 landscape aspect ratio, suitable as a
blog cover image.
```

---

## Team leader's contributions *

> Individual roles and key deliverables completed by team member.

_TODO — review and adjust to match what each person actually did before
submitting; these are drafted splits, not a verified record._

**Maha Kisore (team leader)** — Owned the system's correctness core and
overall architecture. Designed and implemented the CRDT/vector-clock
conflict-resolution engine (`packages/core`: PN-Counter for stock,
vector clocks, field-level merge), the write pipeline (`write-intake` →
SQS FIFO grouped by `item_id` → `conflict-resolver`, with atomic
`TransactWriteItems` commits), and the CDK infrastructure defining every
AWS resource in the stack. Also led the dedicated edge-case hardening
pass against a 25-scenario catalog, which caught and fixed two real
concurrency/correctness bugs before launch, and wrote the property-based
tests proving the PN-Counter merge is commutative and associative.

## Second team member's contributions

**Ramkumar** — Owned the client and the auth/multi-tenant layer. Built
the StockSync Counter React client: the offline queue (IndexedDB),
real-time WebSocket sync, the conflict-review UI, barcode/QR quick-entry,
and the products/checkout flow. Implemented Cognito-based multi-tenant
authentication end to end — self-signup, owner/manager/counter-staff
roles, the JWT authorizer wired into every API route, and the staff
invite flow. Also led the full UI/UX redesign pass: the hero and
sign-in/sign-up screens, dark mode, and the animated, icon-driven visual
system used throughout the app.

## Third team member's contributions

**Yashwanth** — Owned observability, notifications, and the AI-assisted
feature surface. Built the owner-facing analytics dashboard (sales/
revenue rollups, the trust-score conflict-rate metric), the SES
low-stock/conflict email notification pipeline off DynamoDB Streams, and
the CloudWatch metrics/dashboards (`ConflictRate`, `IdempotencyHitRate`).
Integrated Amazon Bedrock for the plain-language same-field-conflict
explainer, kept strictly advisory per design, and worked through the
account-level Bedrock access gating to get it running end to end. Also
drove test coverage on the API layer, including the DynamoDB-Local
integration suite.

---

## Help us evaluate you: your feedback on the AWS services you used *

> Tell us what you didn't like about the AWS services you used and what
> could be better, whether technical or onboarding related.

**Bedrock's account-level model-access gating was the single biggest
friction point.** A brand-new AWS account can't invoke Bedrock models at
all until an "Anthropic use-case details" approval clears — and that
approval goes through a Support case with no guaranteed SLA on Basic
support, which is exactly the plan every new/personal AWS account starts
on. For a hackathon with a hard deadline, an unpredictable, un-appealable
wait on a **generative AI feature specifically** is a real barrier —
Bedrock is the one service most likely to be the differentiator in a
project like this, and it's also the one most likely to be blocked when
you need it most. A self-service "instant sandbox" tier for Bedrock,
similar to how most other services just work the moment you enable them,
would remove a lot of unnecessary hackathon friction.

**AWS Marketplace's payment-instrument checks were opaque.** Separately,
provisioning a Bedrock model subscription through a second account failed
with `INVALID_PAYMENT_INSTRUMENT` even with a valid card on file as the
account default — it turned out the account's *default payment method*
was set to UPI AutoPay, which Marketplace subscriptions silently reject in
favor of a credit/debit card, with no explicit error message pointing at
that as the cause. Discovering the actual root cause took directly testing
the API call and reading the raw exception text, not anything AWS's UI
surfaced proactively.

**SES sandbox mode's requirement that sender *and every recipient* be
individually verified** makes sense for abuse prevention, but for a
demo/hackathon context it means the "real" version of a notification
feature (alerting an arbitrary shop owner's real email) isn't actually
testable without a production-access request — so we could only verify
the mechanism works, not deliver a fully realistic demo of it.

**Amplify Hosting's CLI deploy flow (no GitHub App connected) requires
manually scripting** `create-deployment` → zip → presigned-URL `curl` →
`start-deployment` → poll — it works, but it's clearly the secondary path
next to the git-connected auto-deploy flow, and a couple of the CLI
commands (e.g. `create-deployment` rejecting a second call while a prior
job is still `PENDING`) produce cryptic-enough errors that recovering
requires cross-referencing `get-job` state manually rather than anything
self-explanatory.

---

## What did you like about the AWS services you used? *

> Tell us what worked well for you, whether that was a specific service,
> the docs, the setup, or anything that made building easier.

**CDK made "infrastructure as code" genuinely load-bearing, not just a
buzzword.** Being able to write a unit test that asserts *no IAM policy in
the synthesized template uses a wildcard resource* — and have it actually
catch a real over-broad grant during development — is a level of
confidence a console-clicked stack can't give you. The one time the test
needed an exception (`dynamodb:ListStreams`, which AWS itself has no
resource-level IAM scoping for), CDK's synthesized template made that
completely verifiable rather than a guess.

**DynamoDB Streams + `TransactWriteItems`** were a genuinely elegant fit
for this problem: Streams became a free, already-running event source we
reused for real-time WebSocket push *and* email alerts, without adding any
new write-path code, and `TransactWriteItems` meant a record update, its
audit-log entry, and its idempotency claim could never drift out of sync
with each other even under a crash mid-write.

**Cognito's built-in triggers (post-confirmation, custom user creation)**
made "self-signup creates a shop and makes you its owner" a clean,
declarative flow instead of a custom auth service — and the JWT authorizer
on API Gateway meant every route got tenant isolation for free, without
hand-rolling token verification in every handler.

**The AWS SDK v3's modular clients paired extremely well with
`aws-sdk-client-mock`** — every Lambda handler's AWS calls could be
unit-tested in milliseconds against a mocked client, while the
correctness-critical DynamoDB paths were additionally tested against a
real local DynamoDB instance (`dynamodb-local`) for true integration
coverage. That two-tier testing setup, entirely enabled by how the v3 SDK
is structured, is a big part of why this project has ~200+ tests across
the stack.

**Overall, the actual serverless services (Lambda, DynamoDB, SQS, API
Gateway, Cognito) just worked** — provisioned cleanly through CDK, no
console clicking required, and behaved exactly as documented. The friction
in this build was almost entirely concentrated in Bedrock/Marketplace
account-gating, not in the core services the architecture is built on.
