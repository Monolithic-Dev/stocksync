# Phase 14: Advanced Differentiators

All four directions from the brainstorm, written up in full. Build in
whichever order fits your remaining time — 14a (QR sneakernet sync) is
the strongest single addition if you can only do one; 14c and 14d are
the cheapest; 14b is the riskiest. None of these depend on each other
except where noted.

---

## 14a. QR "Sneakernet" Sync — Offline-to-Offline Data Muling

**Goal:** A device with zero connectivity (no signal, no shared WiFi —
not just "offline from the cloud") can hand its queued transactions to a
nearby device that *does* have connectivity, via a QR code, with no
pairing or app-to-app connection — proving the sync engine's core
guarantee (origin and order don't matter, only the math does) in the
most literal way possible.

**Preconditions:** Phase 6 complete (offline queue exists). Phase 13a
complete (barcode/QR scanning component exists — this reuses it rather
than building a second scanner).

**Implements:** No existing FR — new. Add as FR-25 in `01-PRD.md` if you
want it formally tracked.

### Task Breakdown

1. **Define the transfer packet format** — a compact JSON array of the
   sending device's pending transactions (`idempotency_key`, `item_id`,
   `type`, `quantity` or `field`+`value`, `client_vector_clock`,
   `client_timestamp`), plus the source `counter_id`. Keep payloads small
   by design (a few transactions, not a full day's queue) — QR codes have
   real capacity limits, and reliability drops well before the
   theoretical max.

2. **`apps/web/src/offline/qrExport.ts`**:
   - `exportQueueAsQrPayload(queue): string[]` — serializes the pending
     queue; if it doesn't fit in one QR frame, splits it into a numbered
     sequence (`{part: i, of: N, data: "..."}`) rather than failing or
     silently truncating.

3. **`apps/web/src/components/QrHandoffModal.tsx`** — the sending
   device's UI: renders the QR code (or cycles through the sequence at a
   fixed interval if chunked) for the receiving device to scan.

4. **`apps/web/src/components/QrHandoffScanner.tsx`** (extends the
   Phase 13a scanner rather than duplicating it) — the receiving
   device's UI: scans each frame, tracks which parts have been seen,
   reassembles the full packet once complete. **Does not attempt replay
   on a partial scan** — missing even one chunk must block reassembly,
   not silently process an incomplete batch.

5. **`apps/web/src/offline/replay.ts`** (extend): `replayQueue()` now
   submits both the receiving device's own queue and any muled-in
   transactions in the same batch to `POST /transactions`. The API layer
   needs no changes at all — a muled transaction has the exact same
   shape as one submitted directly, since the server only ever looks at
   the payload, never at which physical device sent the HTTP request.

6. **`QueueDrawer.tsx`** (extend): show muled-in transactions with a
   distinct tag ("received via QR from Counter A") — this is what makes
   the mechanism visible and demo-able, not just functionally correct.

7. **Tests:**
   - `qrExport.test.ts`: a small queue serializes to one frame; an
     oversized queue chunks correctly with reconstructable part indices.
   - `QrHandoffScanner.test.tsx`: scanning all chunks in any order
     reassembles correctly; a partial scan does not trigger replay.
   - Integration: submit a transaction via mule-in on Device B, confirm
     `audit_log` attributes it to Device A's `counter_id`, not B's — the
     same attribution guarantee already proven in Phase 5/7, now
     exercised through a new entry path.

### Real-World Engineering Concerns

- **Idempotency matters even more here.** If Device A later regains
  connectivity and (having forgotten it already muled the transaction)
  submits it again directly, the *same* `idempotency_key` must survive
  the handoff unchanged so the server correctly returns `duplicate`
  rather than double-counting a sale.
- **Attribution integrity.** A muled transaction must retain its
  *original* `counter_id` through the whole path — relabeling it as
  though the receiving device made it would make the audit trail
  actively misleading, which defeats the entire point of the audit
  trail existing.
- **QR reliability is a real-device concern, not a code concern.** Test
  on whatever device/lighting you'll actually record with, the same
  discipline as Phase 13a's camera-permission note.

### Definition of Done

- [ ] Device A in airplane mode (zero connectivity), Device B with real
      connectivity, physically adjacent: A's queued sale displays as a
      QR code, B scans it, B's replay submits both queues, and the
      item's audit log shows correct attribution to A's counter.
- [ ] A queue too large for one frame splits into a scannable sequence
      and reassembles correctly.
- [ ] The muled transaction's `idempotency_key` is confirmed unchanged
      by inspecting the actual submitted payload.
- [ ] All tests in step 7 pass.

### Risks & Blockers

| Risk | Mitigation |
|---|---|
| QR scanning reliability under real demo conditions | Rehearse specifically on the recording device, same discipline as every other demo-critical path in this project |
| Chunked sequences add real UX complexity (timing the cycle, keeping both devices' screens visible to each other) | Keep the demo's specific queue small enough to fit in a single QR frame — save chunking for the "it also handles this" mention, not the live demo itself |

### Time Budget

1–1.5 days, given camera/QR library integration and real cross-device
testing.

### Handoff

This is a genuine capstone demo moment — strong enough to stand
alongside, or even after, the WebSocket real-time push scenario as the
"and it works with *no* network at all" closer.

---

## 14b. Computer-Vision Shelf Reconciliation

**Goal:** A counter can optionally photograph a shelf; a vision model
estimates an item count; if it diverges meaningfully from the system's
computed stock, flag it visibly — giving the system a third, physical
signal beyond what two devices claim about each other.

**Preconditions:** Phase 8 complete (the async, non-blocking, advisory-only
Bedrock integration pattern already exists to extend).

### Task Breakdown

1. **`apps/api/src/lib/vision.ts`**: `estimateShelfCount(imageBase64, itemLabel): Promise<number | null>` — calls Amazon Rekognition's label/object counting, or a vision-capable Bedrock model with a prompt asking for an estimated count of a named item. Returns `null` on any failure, never throws — same non-blocking discipline as `bedrock.ts`'s `explainPriceConflict`.
2. **`apps/api/src/handlers/shelfCheck.ts`** (`POST /items/{item_id}/shelf-check`): accepts a photo, calls `estimateShelfCount`, compares against current computed stock. If the discrepancy exceeds a configurable threshold, writes a new `audit_log` action (`physical_mismatch_flagged`) and sets a new `physical_check` field on the item (`{estimated_count, checked_at, discrepancy}`).
3. **`apps/web/src/components/ShelfCheckButton.tsx`** — camera capture UI, calls the endpoint, shows the result.
4. **Extend `ConflictReviewPanel.tsx`** (or a small sibling component) to render a physical-mismatch flag distinctly from a device-device `needs_review` conflict — different icon/color, and copy that reads as "worth a manual recount," never "the system found theft" or anything accusatory.
5. **Tests:** mock the vision call's response, confirm the threshold logic correctly flags and doesn't-falsely-flag; confirm a vision-call failure never blocks the item's normal stock display.

### Real-World Engineering Concerns

- **This must never auto-correct stock from a photo estimate** — vision-based counting is inherently approximate. It flags for human review, exactly like a price conflict; it never writes a new stock value on its own authority.
- **Frame the copy conservatively** — "roughly," "worth checking," not a precise claim the vision model can't actually back up.

### Definition of Done

- [ ] Photographing a shelf with a deliberately wrong quantity correctly
      flags a mismatch.
- [ ] A photo matching the actual computed stock does not falsely flag.
- [ ] A forced vision-call failure doesn't break the item's normal display.

### Risks & Blockers

| Risk | Mitigation |
|---|---|
| Vision accuracy on cluttered/real shelf photos is unpredictable | Demo with a clean, well-lit, deliberately staged shelf; have a pre-recorded fallback take, same discipline as every other live-camera moment in this plan |

### Time Budget

1 day. This is the riskiest of the four — only attempt it if 14a and 14c
are done with real time still remaining.

---

## 14c. WhatsApp-Native Notifications

**Goal:** Low-stock and conflict-pending notifications go out via
WhatsApp instead of (or alongside) generic email/SMS, using AWS's real,
current WhatsApp integration.

**Preconditions:** Tier 2 item 2.5 (`NotificationLayer.ts`,
`notificationCheck.ts`) exists or is being built alongside this.

### Task Breakdown

1. **AWS console:** create or link a WhatsApp Business Account (WABA)
   via AWS End User Messaging Social's self-guided onboarding.
2. **Start Meta's template approval process immediately** — WhatsApp
   Business requires pre-approved message templates via Meta before you
   can send anything. This has its own lead time, separate from AWS
   setup, and is the single biggest risk in this feature — treat it with
   the same urgency as Phase 9.5's Bedrock model-access step.
3. **`infra/cdk/lib/constructs/NotificationLayer.ts`** (extend): wire the
   End User Messaging Social event destination (inbound webhook → SNS →
   Lambda, per AWS's documented architecture for this service).
4. **`apps/api/src/lib/whatsapp.ts`**: `sendWhatsAppMessage(phoneNumber, templateName, params): Promise<void>` wrapping the End User Messaging Social API call.
5. **Extend `notificationCheck.ts`**: on a threshold breach or stale
   conflict, call `sendWhatsAppMessage` instead of (or alongside) the
   existing SES path; log to `notifications_log` with `channel: "whatsapp"`.
6. **Tests:** mock the End User Messaging Social API call; confirm the
   correct template and parameters are constructed for a low-stock event
   versus a conflict-pending event.

### Real-World Engineering Concerns

- **Meta's template approval timeline is outside your control.** Start
  it the moment you decide to build this feature at all, not after the
  code is written.
- **Phone number and WABA verification also need lead time** — budget
  for this the same way, separately from the coding work itself.

### Definition of Done

- [ ] A real WhatsApp message is received on a real phone when a stock
      threshold is crossed, end to end against the real deployed stack.
- [ ] The correct template renders for both a low-stock and a
      conflict-pending event.

### Risks & Blockers

| Risk | Mitigation |
|---|---|
| Meta template approval isn't done in time | Start it on day one of building this feature; if it's not approved by the time you need to record, fall back to the already-planned SES email path for the demo and mention WhatsApp as "built, pending Meta's approval" in the writeup — still counts as real, shipped work |

### Time Budget

Half a day of actual code — budget the Meta approval lead time
separately, since it doesn't block the coding, only the live
verification.

---

## 14d. The "Bankable Ledger" Framing

**This is a narrative addition, not a code task.** It costs a paragraph,
not an engineering day, and it meaningfully raises the ceiling on how
big the problem you're solving sounds.

**Goal:** Name, explicitly, in the README and the demo's closing line,
that the trust-score data (already planned in `phase-13-new-differentiators.md`
§13c) is a plausible seed for something most small Indian retailers
currently can't get at all: a verifiable transaction history a lender
could actually assess.

### Where this lives

- **README, "Where this goes next" section** (alongside the other Tier 3
  roadmap items already named in `11-PHASED-SCOPE.md`).
- **The last few seconds of the demo video**, right after naming the
  sync engine as reusable infrastructure.
- **The AWS Builder Center blog post**, as the closing paragraph.

### Suggested language (adapt, don't copy verbatim into a public post
without making it your own)

> "Most small Indian retailers run on cash and memory, with no formal,
> verifiable record of their real sales activity — which is a large part
> of why so many can't access formal credit at all. StockSync's audit
> trail is, by construction, a timestamped, tamper-evident record of
> real transactions. We're not building a lending product — but a shop's
> StockSync history is a far more honest starting point for assessing
> creditworthiness than what most lenders can see today."

### Why this is worth including

- It's evidence-based, not hand-wavy — it points at data your system
  already produces as a byproduct of doing its actual job correctly, not
  a speculative new feature.
- It reframes the trust score from "an internal correctness metric" to
  "a social-impact story," which is exactly what "Idea and Impact"
  judging rewards, at zero engineering cost.
- Naming it as explicit Tier 3 roadmap vision (not something you're
  claiming to have built) keeps it honest — you're not overclaiming, you're
  showing you understand the bigger shape of the problem.

### Definition of Done

- [ ] The framing appears in the README, the demo's closing seconds, and
      the blog post, in your own words, not copy-pasted from this doc.
- [ ] It's clearly framed as future vision, not a built feature — no
      claim that StockSync currently does any credit scoring.

### Time Budget

Under an hour. Do this regardless of which other Phase 14 items you
attempt.
