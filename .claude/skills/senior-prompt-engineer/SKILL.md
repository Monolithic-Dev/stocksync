---
name: "senior-prompt-engineer"
description: Prompt design and guardrails for StockSync's four Bedrock-powered features — the price-conflict explainer, the natural-language shop-query assistant, reorder suggestions, and voice-transaction parsing. Use when writing or changing any Bedrock Runtime call, when adding a new AI-assisted feature, when someone asks "what should the prompt say", "how do I ground this in real data", "can the AI just pick the answer", or "is this safe to parse from voice input". Also use before merging any change where a Bedrock response feeds directly into a database write (voice/NL parsing) — that path needs schema validation, not blind trust.
---

# Senior Prompt Engineer — StockSync

Every Bedrock call in this project is a narrow, bounded, non-blocking
feature — never the mechanism that decides correctness. This skill exists
to keep it that way as new AI-assisted features get added, and to give
each of the four existing features a concrete, reviewable prompt design
instead of an ad hoc string built inline in a handler.

## Core guidance

### The three rules every Bedrock call in this project follows

1. **Grounded, not general-knowledge.** Every prompt that answers a
   question about the shop's data must have that data fetched from
   DynamoDB and passed as context first — never let the model answer from
   what it "knows" about typical shops or typical prices. The `/assistant/ask`
   endpoint's `grounded_in` response field exists specifically so the UI
   (and a reviewer) can verify this.
2. **Advisory, never authoritative, for anything touching conflict
   resolution.** The price-conflict explainer describes a discrepancy in
   plain language; it never outputs "the correct price is X" as something
   the system auto-applies. A human always makes the final call on a
   `needs_review` item — see `senior-architect`'s guardrail on this exact
   point.
3. **Non-blocking on the correctness-critical path.** No Bedrock call may
   sit between a write and its resolution. If Bedrock times out, errors, or
   is simply skipped, the core write/merge must have already completed
   correctly without it.

### Voice and free-text input needs schema validation, not trust

The voice-transaction and NL-assistant features both turn free text (a
transcript, or a typed question) into something that touches real data —
either a structured transaction or a targeted DynamoDB query. Treat the
model's output the same way you'd treat any external user input:
validate it against the expected schema (`item_id` must exist, `quantity`
must be a positive number, `type` must be `sale` or `restock`) before it's
allowed anywhere near `POST /transactions`. A malformed or unexpected
model output should be rejected and surfaced to the user for correction,
never silently coerced into "something close enough."

### The four features, at a glance

| Feature | Endpoint | Blocking? | Output goes to |
|---|---|---|---|
| Price-conflict explainer | internal (called from conflict-resolver Lambda) | No — fires after the conflict is already flagged | Display only, `conflict_candidates.bedrock_explanation` |
| NL shop-query assistant | `POST /assistant/ask` | Yes, for this request only — it's a read, not a write | Display only, with `grounded_in` |
| Reorder suggestions | `POST /assistant/reorder-suggestion` | Yes, for this request only — read-only | Display only, owner decides whether to act |
| Voice transaction entry | `POST /transactions/voice` | Yes, but the *parsed result* is validated and then goes through the normal, unmodified transaction pipeline | `POST /transactions`, after schema validation |

See `references/bedrock-prompt-templates.md` for the actual system/user
prompt text for each.

## Watch out for

- **A prompt that asks Bedrock to "decide" or "resolve" anything on the
  conflict path.** Rewrite it to ask for an *explanation*, not a decision —
  the wording difference is the guardrail.
- **Skipping schema validation on voice/NL-parsed output "because it
  usually works."** This is exactly the input class most likely to be
  malformed (transcription errors, ambiguous phrasing) — validate every
  time, not just when something looks obviously wrong.
- **A blocking Bedrock call inserted into the write-intake or
  conflict-resolver Lambda's critical path.** If a future feature needs
  richer AI reasoning during resolution, invoke it asynchronously
  (a second Lambda triggered off the same event) rather than making the
  resolver wait on it.
- **Testing that asserts exact AI wording.** Test that grounding data is
  correctly fetched and passed, and that the response is displayed in the
  right place — never assert the model's exact phrasing, which isn't a
  contract.
- **A `grounded_in` field that's decorative rather than real.** If the UI
  shows a data source but the prompt didn't actually restrict itself to
  that data, the grounding claim is false — verify the prompt structure
  matches the field before trusting it.

## Hard questions to insist on before proceeding

- **"What happens if Bedrock is slow or down right now, for this specific
  feature?"** For the price-conflict explainer: the conflict is still
  flagged and both values still shown — fine. For voice entry: the user
  needs a clear "couldn't process, try again or type it" fallback, not a
  silent hang. If this answer isn't obvious for a new feature, it's not
  ready to ship.

## Hand off to

- **senior-architect** — if a new AI feature's output would touch
  concurrent/synced data, confirm it goes through the standard write
  pipeline (idempotency, FIFO ordering, conflict resolution) rather than a
  new, parallel write path.
- **senior-qa** — for the schema-validation test coverage on voice/NL
  parsed output specifically (see the DLQ-adjacent "malformed input"
  testing note in that skill).
