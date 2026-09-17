# Phase 12 [CONDITIONAL — Tier 2]: Analytics, Notifications, AI Expansion & Voice Entry

**Do not start this phase unless Phase 11 finished with real margin remaining before Phase 9 was due to start.** This is the last, most optional layer in the entire plan — per `11-PHASED-SCOPE.md`'s explicit ordering (items 2.4–2.8), stop at whichever sub-step you're on the moment time runs out.

## Header

**Goal:** A daily analytics rollup and owner dashboard, low-stock/stale-conflict notifications, a grounded natural-language shop-query assistant, Bedrock-reasoned reorder suggestions, and (only if everything else here is solid) voice-based transaction entry.

**Preconditions:** Phase 11 complete (real shop/product data exists to analyze). Phase 8 complete (the Bedrock integration pattern — async, non-blocking, advisory-only — is already established and should be reused, not reinvented, for every feature below).

**Implements:** `01-PRD.md` §14.3–§14.5/FR-18/FR-19/FR-20/FR-21, `02-ARCHITECTURE.md` §10.4–§10.8, `03-DATABASE-SCHEMA.md` §8.5/§8.6, `04-API-SPEC.md` §5.3–§5.7, `senior-prompt-engineer/references/bedrock-prompt-templates.md` §2–4, `11-PHASED-SCOPE.md` items 2.4–2.8.

---

## Task Breakdown (in this exact priority order — do not reorder)

1. **`infra/cdk/lib/constructs/AnalyticsPipeline.ts`** + **`apps/api/src/handlers/dailyRollup.ts`**: EventBridge-scheduled Lambda aggregating the prior day's `audit_log` per shop/item into `daily_analytics` (per `03-DATABASE-SCHEMA.md` §8.5). `apps/web/src/pages/DashboardPage.tsx` + `AnalyticsChart.tsx` read only from this rollup table, never scanning `audit_log` live.

2. **`infra/cdk/lib/constructs/NotificationLayer.ts`** + **`apps/api/src/handlers/notificationCheck.ts`**: SNS topic + SES subscription; scheduled check against stock thresholds and stale `needs_review` conflicts; logs to `notifications_log` (§8.6).

3. **`apps/api/src/handlers/askAssistant.ts`** (`POST /assistant/ask`): implements the grounded NL-query pattern from `senior-prompt-engineer/references/bedrock-prompt-templates.md` §2 — fixed, known retrieval functions only (today's sales, low-stock list), never open-ended agent tool access. Response includes `grounded_in` per `04-API-SPEC.md` §5.5.

4. **`apps/api/src/handlers/reorderSuggestions.ts`** (`POST /assistant/reorder-suggestion`): reads `daily_analytics` sales velocity + `suppliers.lead_time_days`, uses template §3. Framed in the UI explicitly as LLM-assisted reasoning, not a trained forecast (FR-20/21's spirit).

5. **Only if 1–4 above are solid with time still remaining:** **`apps/api/src/handlers/voiceTransaction.ts`** (`POST /transactions/voice`) — Transcribe → Bedrock structuring (template §4) → **mandatory schema validation** (item-name-to-real-item-id resolution, type/quantity validation) → submitted through the unmodified Tier-1 transaction pipeline. This is the riskiest, highest-effort item in this phase — it is listed last on purpose.

6. **Tests:** rollup correctness (seed known `audit_log` entries, assert the computed rollup matches by hand-calculation); notification firing on a threshold breach; `askAssistant` refuses to answer when retrieval returns nothing relevant (returns "I don't have data for that," doesn't guess); voice parsing rejects a transcript that doesn't resolve to a real `item_id` in the shop's catalog rather than silently guessing one.

## Real-World Engineering Concerns

- **Every Bedrock call here follows the same non-blocking, advisory-only, grounded-in-real-data pattern established in Phase 8 and codified in `senior-prompt-engineer`** — this phase should feel like applying an established pattern four more times, not inventing a new integration approach each time.
- **Voice input is untrusted input.** Treat the parsed transaction the same as any external user input — validate before it touches the write pipeline, per the guardrail already documented in `senior-prompt-engineer`'s SKILL.md.

## Definition of Done

- [ ] The dashboard shows a real daily rollup, correct to hand-calculation against seeded audit log data.
- [ ] A stock level crossing its threshold triggers a real email notification, confirmed received.
- [ ] `askAssistant` correctly refuses to answer on an out-of-scope question rather than hallucinating a plausible-sounding number.
- [ ] (If attempted) voice entry correctly rejects an ambiguous/unresolvable transcript rather than guessing a transaction.
- [ ] The Tier-1 demo scenario (Phase 7) and any Phase 11 checkout flow still pass unmodified.

## Risks & Blockers

| Risk | Mitigation |
|---|---|
| Voice entry's item-name-to-item-id fuzzy matching is unreliable with real speech-to-text transcription errors | This is exactly why it's last in this phase's priority order — cut it without guilt if it's not converging quickly |
| Analytics dashboard becomes a larger frontend effort than expected, crowding out the notification/assistant work | Ship a minimal table-based dashboard before investing in chart polish — `AnalyticsChart.tsx`'s visual quality is not what's being judged |

## Time Budget

**Not pre-allocated** — "Extra Day C" from `11-PHASED-SCOPE.md`, spent only with genuine margin before Phase 9. Stop at whichever numbered task you're on; a project that ships tasks 1–3 cleanly is a stronger submission than one that half-ships all five including a broken voice feature.

## Handoff

Whatever is completed here becomes additional platform depth mentioned briefly in Phase 10's README/writeup — it never changes Phase 9/10's own definition of done, which is scoped entirely to Tier 1. Tag: `phase-12-complete` (only if reached, and only for whichever numbered tasks were actually finished).
