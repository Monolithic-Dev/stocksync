# StockSync — Bedrock Prompt Templates

Concrete system/user prompt text for all four Bedrock-powered features.
Each includes the guardrail it's designed to enforce — don't strip these
out for brevity when adapting them.

---

## 1. Price-Conflict Explainer

**Called from:** the conflict-resolver Lambda, only when a genuine
same-field conflict (`needs_review`) has already been detected and stored.
Never called to help decide *whether* something is a conflict — that
decision is made in `packages/core`, deterministically, before Bedrock is
ever invoked.

**System prompt:**
```
You are a plain-language assistant explaining data conflicts in a small
shop's inventory system to a shop owner who is not technical. Be concise:
1-2 sentences. Describe the discrepancy and possible causes. Do not state
which value is correct — the owner will decide that.
```

**User prompt (templated):**
```
Two shop counters set different {field} for the same item while both were
offline. {counter_a_id} set it to {value_a}, {counter_b_id} set it to
{value_b}, about {time_delta} apart. Explain this discrepancy in plain
language and suggest what the owner should consider when picking the
correct value.
```

**Guardrail check:** the prompt asks for an explanation and "what to
consider," never "which is correct." If a future edit changes this to ask
Bedrock to pick a value, that's a violation — see `senior-architect`.

---

## 2. Natural-Language Shop-Query Assistant

**Called from:** `POST /assistant/ask`, after a small, fixed set of
DynamoDB queries has already run based on detected intent (see
`04-API-SPEC.md` for the endpoint contract). Bedrock never queries the
database itself — it only reasons over data already fetched and handed
to it.

**System prompt:**
```
You answer questions about a shop's sales and inventory data using ONLY
the data provided below. If the data provided does not answer the
question, say so plainly — do not guess or use outside knowledge about
typical shops, prices, or sales patterns.
```

**User prompt (templated):**
```
Shop data for {date_range}:
{retrieved_data_as_json}

Question: {user_question}

Answer in one or two plain-language sentences, referencing the actual
numbers above.
```

**Guardrail check:** `retrieved_data_as_json` must be non-empty and must
be the actual source the response's `grounded_in` field names. If the
retrieval step returns nothing relevant, skip the Bedrock call entirely
and return "I don't have data for that" directly — don't send an empty
context and hope the model says the right thing.

---

## 3. Reorder Suggestions

**Called from:** `POST /assistant/reorder-suggestion`, using the item's
`daily_analytics` rollup and its supplier's `lead_time_days`.

**System prompt:**
```
You suggest reorder timing for a shop's inventory based on recent sales
velocity and supplier lead time. Be concrete (a day or quantity), but
always frame this as a suggestion based on recent trends, not a
guarantee — sales patterns can change.
```

**User prompt (templated):**
```
Item: {item_name}
Current stock: {current_stock}
Average daily sales (last 7 days): {avg_daily_sales}
Supplier lead time: {lead_time_days} days

Suggest when to reorder and roughly how much, in one or two sentences.
```

**Guardrail check:** this is explicitly framed to the user as LLM-assisted
reasoning over real numbers, not a trained forecast — don't let UI copy
drift into presenting it as a statistically validated prediction.

---

## 4. Voice Transaction Parsing

**Called from:** `POST /transactions/voice`, after Amazon Transcribe has
already converted audio to text. This is the highest-risk prompt in the
project — its output is validated and then submitted as a real
transaction, so schema conformance matters more than natural phrasing.

**System prompt:**
```
Convert the following spoken shop transaction into a JSON object with
exactly these fields: item_name (string, as spoken), type ("sale" or
"restock"), quantity (positive integer). Output ONLY the JSON object, no
other text. If the transcript is ambiguous or doesn't describe a clear
transaction, output {"error": "could not parse a clear transaction"}
instead.
```

**User prompt (templated):**
```
Transcript: "{transcript}"
```

**Post-processing (mandatory, not optional):**
1. Parse the response as JSON — if it fails to parse, treat as an error,
   surface "couldn't process, try again or type it" to the user.
2. If the response contains an `error` key, surface it directly rather
   than attempting to salvage a partial transaction.
3. Resolve `item_name` to a real `item_id` via exact or fuzzy match
   against the shop's actual product catalog — never accept an
   `item_id`-shaped string directly from the model, since it hasn't seen
   the catalog's real ids.
4. Validate `type` is exactly `"sale"` or `"restock"`, and `quantity` is a
   positive integer, before constructing the actual `POST /transactions`
   payload.
5. Only after all of the above passes does this become a normal write,
   indistinguishable from one typed by hand, going through the full
   idempotency/FIFO/conflict-resolution pipeline unchanged.

**Guardrail check:** steps 1–4 above are not optional hardening for later —
they're the difference between "voice entry" and "an unvalidated write
path that happens to be fed by speech." See `senior-prompt-engineer`
SKILL.md's core guidance on this exact point.
