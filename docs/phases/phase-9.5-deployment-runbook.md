# Phase 9.5: Real AWS Deployment & Live Rehearsal

**This is the actual highest-priority work right now — more urgent than
anything in this response about making the project bigger.** Everything
in `01-PRD.md` through Phase 9 is proven on paper and against local
substitutes. Nothing is proven against real AWS yet. Ship It's first,
non-negotiable requirement is a live URL — until this phase is done, you
do not have a submittable project, regardless of how correct the code is.

## Header

**Goal:** The full CDK stack is deployed to a real AWS account, the
frontend is live on Amplify Hosting wired to the real backend, and the
core conflict scenario has been rehearsed successfully at least 5 times
against that real, deployed stack — not the local dev server.

**Preconditions:** Phase 9 complete per the status report (40/40 +
28/28 + 17/17 tests passing, `cdk synth` producing 53 clean resources).
`fix/phase-9-docs-and-windows-test-infra` merged.

**Implements:** The "Next steps, in order" section of `STATUS.md`,
`09-BUILD-PLAN.md` Day 10's deploy step, `05-TECH-STACK.md`'s Amplify
coordination note.

---

## Task Breakdown

1. **Merge the pending branch first.** `fix/phase-9-docs-and-windows-test-infra`
   — do this before touching infrastructure, so the deploy is from a
   known, clean `main`.

2. **AWS account and budget guardrail** (if not already done from Phase 1):
   - Confirm the account has real credentials configured locally —
     `aws sts get-caller-identity` should return a real account ID, not
     an error.
   - Console → Budgets → confirm the $20 alarm from Phase 1 exists and
     is still active.

3. **Enable Bedrock model access — do this before the CDK deploy, not
   after.** Console → Amazon Bedrock → Model access → request/enable
   `anthropic.claude-3-haiku-20240307-v1:0`. **This can take anywhere
   from instant to a noticeable delay depending on account history** —
   start it now so it's not the thing blocking you an hour before
   recording.

4. **Bootstrap and deploy:**
   ```bash
   cd infra/cdk
   npx cdk bootstrap
   npx cdk diff        # review before applying — this is the real version
                        # of the "review before apply" discipline every
                        # earlier phase doc referenced
   npx cdk deploy
   ```
   - Save the stack outputs (API Gateway REST URL, WebSocket URL) —
     Amplify needs these in step 6.
   - `aws dynamodb list-tables` — confirm all 4 tables exist with the
     literal names the phase docs assume (`inventory_records`,
     `write_dedup`, `audit_log`, `ws_connections`).
   - `aws cloudwatch get-dashboard --dashboard-name <name>` — confirm the
     `Observability` construct actually deployed, not just synthesized.

5. **Re-run the DynamoDB-Local-backed integration suite from a real
   network, not the sandboxed environment that produced the status
   report** (`conflictResolver.test.ts`, 13 tests) — this is explicitly
   flagged as unverified in that environment due to a slow ~55MB
   download, not a known failure. Confirm it's actually green before
   trusting it.

6. **Deploy the frontend via Amplify Hosting.** Two ways to do this:
   - **Console, GitHub-connected** (auto-deploys on push): connect the
     repo, point at `apps/web`, set `VITE_API_BASE_URL` and
     `VITE_WEBSOCKET_URL` (the actual names — see
     `apps/web/src/api/client.ts` — not `VITE_API_URL`/`VITE_WS_URL`) in
     Amplify's environment variables to the CDK stack's actual outputs
     from step 4.
   - **CLI, manual zip deploy** (no GitHub/OAuth step, faster to get a
     first URL): `VITE_API_BASE_URL=... VITE_WEBSOCKET_URL=... npx vite
     build` inside `apps/web` (Vite bakes these into the built JS at
     build time, so they must be set *before* building, not after), zip
     `apps/web/dist`, then `aws amplify create-app` →
     `create-branch` → `create-deployment` (returns a presigned S3
     `zipUploadUrl`) → `curl -X PUT -T <zip> <zipUploadUrl>` →
     `start-deployment`. Trade-off: a future code change needs this
     whole sequence re-run manually, not just a `git push`.
   - Either way, getting the API URLs wrong produces a frontend that
     builds successfully but can't reach the backend, which looks like a
     mysterious blank/broken app, not an obvious config error — this is a
     real, documented coordination gap (`05-TECH-STACK.md`), not
     automatic.
   - Confirm the build succeeds and the Amplify-provided URL loads.

7. **Seed real demo data against the real stack:**
   ```bash
   npm run seed:demo
   ```
   Confirm via the deployed frontend (not curl) that the seeded items
   appear.

8. **Rehearse the core scenario live, 5+ times, per `10-DEMO-PLAN.md`** —
   against the real Amplify URL and real deployed API, using the actual
   `ConnectivityToggle`, not DevTools. This is the step that actually
   satisfies Phase 7's original Definition of Done, which local-only
   validation could not.

9. **Run the Playwright e2e suite against the real deployed frontend**
   (point its base URL at the Amplify URL instead of localhost) — this
   is the automated equivalent of step 8, and catches timing issues a
   human rehearsal might not hit consistently.

10. **Confirm the CloudWatch dashboard shows real, non-zero data** after
    steps 7–9 generate real traffic — this is what actually closes out
    Phase 9's dashboard checklist item, which could only be "pending"
    until now.

## Real-World Engineering Concerns

- **CORS between Amplify's domain and API Gateway.** If `RealtimeApi.ts`'s
  CORS config was written assuming `localhost` during local dev, confirm
  it also allows the real Amplify domain — this is one of the most common
  "works locally, breaks once deployed" surprises in exactly this kind of
  split-hosting setup.
- **Cold starts on first real invocation.** The very first request to
  each Lambda after deploy will be slower than every subsequent one —
  don't let a slow first curl call be mistaken for a real performance
  problem; re-test after a warm-up call.
- **IAM propagation delay.** Occasionally a freshly-deployed IAM role
  isn't immediately usable by its Lambda for the first few seconds —
  if the very first invocation after deploy fails with an access-denied
  error that a retry resolves, that's this, not a real permissions bug.

## Definition of Done

- [ ] `npx cdk deploy` succeeds from a real account with real credentials.
- [ ] All 4 tables, both queues, all 8 Lambdas, and the WebSocket API are
      confirmed live via the AWS CLI, not just `cdk synth` output.
- [ ] Bedrock model access is confirmed enabled (a real `explainPriceConflict`
      call against the deployed Lambda returns a real explanation, not a
      access-denied error).
- [ ] The Amplify-hosted frontend loads, shows seeded data, and a
      transaction submitted through it actually reaches the real backend.
- [ ] The core conflict scenario (US-3) has been rehearsed successfully
      5 times in a row against the real deployed stack.
- [ ] The Playwright suite passes against the real deployed frontend URL,
      not just localhost.
- [ ] The CloudWatch dashboard shows real, non-zero `ConflictRate` and
      `IdempotencyHitRate` data.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Bedrock model access approval takes longer than expected | Started in step 3, before the deploy — gives it maximum lead time |
| CORS misconfiguration between Amplify and API Gateway | Test this specifically and first, before spending time on the full rehearsal — a broken CORS config makes everything downstream look broken too |
| The DynamoDB Local suite still doesn't pass once actually re-run | This is the one item genuinely unverified rather than just undeployed — if it fails for a real reason (not just environment slowness), treat it as a real Phase 9 regression, not a deployment issue |
| Deploy succeeds but rehearsal reveals a timing issue that never showed up locally | This is exactly why step 8 exists as a separate, required step from "the code passed its tests" — go back to Phase 5/7's playbook for diagnosing it, don't treat it as a new, unprecedented problem |

## Time Budget

**This should be achievable in well under a day of focused work** if
nothing goes wrong, but budget a full day given it's the first time this
exact stack has touched real AWS — assume at least one of the risks above
actually happens, because that's the norm for a first real deploy, not
the exception.

## Handoff

Once this is done: Phase 10 (demo recording) can proceed with a real,
confirmed-working, deployed stack — no more caveats about local-only
validation. Everything in the companion strategy doc about making the
project bigger should wait until this phase's Definition of Done is
fully checked off, not started in parallel with it.
