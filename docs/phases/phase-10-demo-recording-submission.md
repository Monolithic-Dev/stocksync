# Phase 10: Demo Recording & Submission

## Header

**Goal:** The 3-minute demo video is recorded and finalized, the README and AWS Builder Center writeup are written, the final deployment is verified working from a clean environment, and the submission is in with time to spare.

**Preconditions:** Phase 9 complete (system hardened, edge cases addressed, dashboard live).

**Implements:** `10-DEMO-PLAN.md` in full, `01-PRD.md` §10 (Success Metrics) and §12 (Learning), `09-BUILD-PLAN.md` Day 10, the hackathon's stated submission requirement (public repo + 2–3 min demo video + short writeup).

---

## Task Breakdown

1. **Final script pass**, incorporating Phase 7's recorded wall-clock timing notes into `10-DEMO-PLAN.md`'s script — adjust the stated timings (0:00–0:20, 0:20–1:00, etc.) if real rehearsal showed the reconnect/resolution step takes meaningfully longer or shorter than originally estimated.

2. **Pre-recording checklist:**
   - Run `scripts/reset-demo.ts` immediately before recording.
   - Confirm both browser windows are logged into the correct counters and the seeded item (`Parle-G 100g`, stock 50) is in its clean starting state.
   - Confirm the CloudWatch dashboard tab is ready to switch to for the "architecture, fast" beat.
   - Close anything on screen unrelated to the demo (notifications, unrelated tabs).

3. **Record.** Expect 3–5 takes — this is normal, not a sign something is wrong. Follow `10-DEMO-PLAN.md`'s script exactly:
   - 0:00–0:20 problem statement.
   - 0:20–1:00 cause the conflict (both counters offline, concurrent sales).
   - 1:00–1:45 reconnect, verify the arithmetic out loud, show the audit log.
   - 1:45–2:15 the same-field price conflict, including the Bedrock explanation appearing.
   - 2:15–2:40 architecture, fast, naming each AWS service at the point it's relevant.
   - 2:40–3:00 close, naming the sync engine as reusable infrastructure, not a single app.

4. **Watch the recording once, cold**, as if seeing the project for the first time — per `10-DEMO-PLAN.md`'s rehearsal checklist. Fix anything confusing without re-recording if a text overlay/caption can clarify it instead.

5. **Have a fallback take ready** from an earlier successful rehearsal (screen-recorded, not just remembered) in case the final live recording session is unexpectedly flaky — per `10-DEMO-PLAN.md`'s explicit guidance.

6. **Write the README** (repo root), covering:
   - The problem statement (from `01-PRD.md` §2), stated in 2–3 sentences.
   - The architecture, summarized (link to the full `docs/` folder rather than reproducing all of it).
   - **"What we learned"** — name the specific unfamiliar concepts from `01-PRD.md` §12 (vector clocks, PN-Counters, DynamoDB Streams as event-sourcing, TransactWriteItems, API Gateway WebSocket lifecycle) — this explicitly counts toward the "Learning" judging criterion, so state it, don't leave it implicit.
   - A link to the deployed live URL.
   - A link to the demo video.

7. **Write the AWS Builder Center blog post** (eligible for the Best Blog prize per the hackathon rules) — can reuse the README's technical content but should read as a narrative (the problem, the "aha" of choosing a PN-Counter, the bug caught and fixed) rather than pure reference documentation.

8. **Final deployment verification:**
   - `npx cdk deploy` one final time from a clean `git clone` of the repo (not your existing working directory) — this catches "works on my machine" gaps like an untracked local `.env` value.
   - Open the deployed frontend URL in a fresh incognito window, confirm the seeded demo data loads and a basic transaction works, end to end, against the real deployed stack.

9. **Submit** — public repo link, demo video, writeup — with several hours of margin before the deadline, not at the wire. Confirm submission was actually received (a confirmation email/page), don't assume a form submit succeeded silently.

## Real-World Engineering Concerns

- **This phase has essentially zero new code** — its engineering discipline is verification and communication, not construction. Resist the urge to "just fix one more thing" in the code once recording has started; a last-minute change that isn't re-rehearsed is a real risk to a video with no retakes after submission.
- **The clean-clone deploy check (step 8) is the single most valuable verification in this phase** — it's the only step that would catch "it works because of something on my machine that isn't actually in the repo."

## Definition of Done

- [ ] A finished demo video exists, at or under 3 minutes, showing the live-conflict scenario and the AI-assisted same-field conflict, both working as shown (not narrated as "this would work").
- [ ] README and AWS Builder Center writeup are both published.
- [ ] A completely clean `git clone` + `npx cdk deploy` succeeds and the resulting live URL works in a fresh incognito window.
- [ ] The hackathon submission form shows a confirmed, received state.
- [ ] Submission completed with measurable time (hours, not minutes) before the deadline.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Recording reveals a bug that only shows up under the specific camera/screen-recording setup (e.g. a resolution-dependent layout issue) | This is exactly why step 4 (watch cold) happens before considering the video final — catch it here, not after submission |
| Clean-clone deploy fails due to an untracked local dependency or credential | This is a real, sometimes late-discovered risk — budget time for it specifically rather than assuming the existing working deploy is sufficient proof |
| Submission portal has an upload size limit or format requirement not accounted for | Check the actual submission form's requirements (video format/size, repo visibility) well before the final recording, not after |

## Time Budget

**1 day**, but front-load the pre-recording checklist and clean-clone verification (steps 2 and 8) to the *morning* of this day if at all possible, so any last-minute infrastructure surprise still has hours of slack rather than being discovered at the deadline.

## Handoff

There is no next phase for Tier 1 — this is the finish line. If Phases 11/12 (Tier 2) were attempted and completed with real margin before this phase began, mention them briefly in the README/writeup as additional platform depth, but never let their inclusion delay or complicate the Tier-1 submission checklist above. Tag: `phase-10-complete` / `submission`.
