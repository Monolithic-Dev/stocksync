# StockSync — 3-Minute Submission Video: Editing Guide + Script

You already have real footage: **`demo-assets/stocksync-demo-silent.mp4`**
(43 seconds, silent, at the repo root, gitignored). It's raw B-roll of an
actual automated run against the live app — not long enough to fill 3
minutes on its own. This doc tells you exactly which few seconds of that
file to use under each beat of the narration, and how to stretch each
segment to fill its beat's time (mostly: freeze the last frame and hold
it while you keep talking). Timestamps below are read directly off the
real file, not estimated.

**Total runtime budget: 180 seconds**, covering the four things the
submission form requires: about the project, tech stack/architecture, AWS
usage, learning/growth.

---

## How to build the final cut, mechanically

1. Import `stocksync-demo-silent.mp4` into your editor (CapCut, DaVinci
   Resolve, Premiere, even a phone editor — any editor that can freeze a
   frame and trim clips works).
2. For each beat below, cut out the **source range** listed and drop it
   on the timeline.
3. Where the source range is shorter than the beat's duration, **hold the
   last frame** of that range for the remaining time (every editor has a
   "freeze frame" or "extend still" option — right-click the clip's last
   frame). This is why the numbers below always show a short "real
   footage" range plus a "hold" instruction.
4. Record yourself reading the **Say** line for that beat (or read the
   whole transcript once as one continuous take, then line it up against
   the cuts — easier if you're not confident about hitting exact beat
   boundaries live).
5. Two source ranges below are explicitly marked **skip this** — cut them
   out entirely. They're redundant sign-in animations that happened
   because each recording segment started its own browser session; you
   don't need to show signing in three separate times.

---

## Beat 1 — About the project (0:00–0:15, 15s)

**Source range:** 0:00–0:07 (hero page loading in, headline animating).
**Hold:** freeze on 0:04–0:05 (headline fully settled) for the rest of
the beat.

**Say:**
> "Small shops running two billing counters share one shaky connection.
> When it drops and both sell the same item, most systems let whoever
> reconnects last silently overwrite the other's sales. StockSync makes
> that mathematically impossible."

---

## Beat 2 — Cause the conflict, live (0:15–0:50, 35s)

**Source range:** 0:12–0:19 (skip 0:07–0:12 — that's a second, redundant
sign-in from the next recording segment; start the cut at 0:12 where both
counters already show the item grid, green "Online").
**Hold:** freeze on 0:18–0:19 (both counters mid-sale, red "Offline") for
the remainder of the beat.

Real events inside this range, if you want to narrate in sync rather than
just hold a still: 0:12–0:13 both Online → 0:14 both flip to Offline (red)
→ 0:15–0:19 stock numbers drop on both sides as sales happen.

**Say:**
> "Both counters go offline — right now, live. Counter A sells 5, then 2
> more. Counter B sells 3. Neither can see the other's sale. This is the
> exact case most offline-sync features never actually handle."

---

## Beat 3 — Reconnect and prove it with arithmetic (0:50–1:25, 35s)

**Source range:** 0:20–0:25 (0:20 is the reconnect/reload moment — you'll
see a brief loading-skeleton flash — through 0:25, both counters green
again, stock settled, audit trail opening).
**Hold:** freeze on 0:24–0:25 (audit trail visible) for the remainder.

**Say:**
> "Reconnect both. Watch the number: 50, minus 5, minus 2, minus 3 — 40,
> on both screens, regardless of which counter reconnected first. Every
> sale counted, nothing silently lost. The audit log shows all three
> sales, correctly attributed to the right counter."

---

## Beat 4 — The hard case: same-field conflict + AI (1:25–1:50, 25s)

**Source range:** 0:26–0:35 (0:26–0:27 both flip Offline again for the
price edit, 0:28–0:29 the price fields get edited, 0:30–0:35 the amber
"Conflicting 'price' value" banner appears and holds with both candidate
values, 15 and 18).
**Hold:** none needed — this range is almost exactly the beat's length.

Note honestly, if it's visible in your footage: the banner shows
"Generating explanation…" rather than actual Bedrock text, because the
account's Bedrock access is still gated at recording time. If that's
still true when you record narration, either say "calls Amazon Bedrock to
explain" (accurate — it does call it, the call just hasn't cleared yet)
or skip the word "explain" and just say it flags the conflict for a
human. Don't claim the explanation text appears if the screen doesn't
show it.

**Say:**
> "Here's the case that can't be auto-merged: both counters set a
> different price while offline. StockSync never guesses — it flags it
> for a human, shows both values, and calls Amazon Bedrock to explain the
> disagreement in plain language. The AI explains; it never decides."

---

## Beat 5 — Tech stack and architecture (1:50–2:25, 35s)

**Source range:** none — there's no footage of this, by design (the
original demo plan calls for a diagram here, not more live UI). Use a
static image instead: a screenshot of the Mermaid diagram in the
[README](../README.md#architecture) (open the README on GitHub, where it
renders, and screenshot it), or keep holding Beat 4's conflict-banner
frame as quiet B-roll while you narrate over it — either works.

**Say:**
> "Under the hood: a React client with an IndexedDB offline queue talks
> to API Gateway — REST for writes, WebSocket for live push. Lambda
> write-intake checks for duplicates and enqueues into SQS FIFO, grouped
> by item ID, not the sending counter, so every write touching one item
> stays strictly ordered. A second Lambda, conflict-resolver, merges with
> vector clocks and a PN-Counter CRDT, then commits the record, its audit
> entry, and its idempotency claim atomically via TransactWriteItems."

---

## Beat 6 — How AWS powers the rest of the product (2:25–2:50, 25s)

**Source range:** 0:41–0:43 (skip 0:36–0:41 — another redundant sign-in
from the third recording segment; the dashboard itself only appears right
at the very end of the file, from 0:41 to 0:43.2 when the footage ends).
**Hold:** freeze on the last frame (0:43) for the rest of the beat — the
dashboard cards (Total revenue, Last 7 days, Trust score, Low stock) are
fully visible there.

**Say:**
> "Beyond the core engine: Amazon Cognito handles real multi-tenant
> auth — owner, manager, counter-staff roles, every route verifying a
> signed token. DynamoDB Streams also feeds an Amazon SES email alert
> when stock runs low, and Amazon CloudWatch tracks conflict rate in
> production. The whole stack is defined as code with AWS CDK and
> deployed to a real AWS account."

---

## Beat 7 — Learning and growth, and the close (2:50–3:00, 10s)

**Source range:** none needed — reuse Beat 1's held hero-page frame
(0:04–0:05), or cut to a plain StockSync logo card if you have one. A
clean, static closing frame reads better here than more UI footage.

**Say:**
> "Building this taught me CRDTs aren't academic — they make 'offline
> and correct' true at once. This is the sync engine underneath a
> point-of-sale app, live on AWS today."

---

## Timing cheat-sheet

| Beat | Narration time | Source range used | Needs hold? |
|---|---|---|---|
| 1. About the project | 0:00–0:15 (15s) | 0:00–0:07 | Yes, ~8s |
| 2. Cause the conflict | 0:15–0:50 (35s) | 0:12–0:19 | Yes, ~28s |
| 3. Reconnect + arithmetic | 0:50–1:25 (35s) | 0:20–0:25 | Yes, ~30s |
| 4. Same-field conflict + AI | 1:25–1:50 (25s) | 0:26–0:35 | No |
| 5. Tech stack & architecture | 1:50–2:25 (35s) | none (use a diagram) | — |
| 6. AWS services tour | 2:25–2:50 (25s) | 0:41–0:43 | Yes, ~23s |
| 7. Learning & growth + close | 2:50–3:00 (10s) | reuse Beat 1's frame | Yes, ~10s |

**Total: 180s / 3:00 exactly.** If a beat's narration runs a little
faster or slower than planned when you actually record your voice, adjust
the *hold* duration for that beat, not the source footage range — the
source ranges above are the only "real" moments in the whole video;
everything else is a held still frame, so they're the cheapest thing to
stretch or compress.

## If you'd rather re-record instead of editing a freeze-frame video

Every action in the footage was driven by a Playwright script that's no
longer in the repo (cleaned up after recording), but the exact choreography
is: sign in on two browser windows as the same shop account, pick "Counter
A" / "Counter B", toggle both offline, sell 5+2 on A and 3 on B, reconnect,
open the audit trail for "parle-g", toggle offline again, set the price to
two different values on each counter, reconnect. If you'd rather perform
this live on camera at a natural pace (filling the full 3 minutes without
any freeze-frames), that's also completely valid — see
[`docs/general/10-DEMO-PLAN.md`](general/10-DEMO-PLAN.md) for the
original live-performance version of this same script, including the
rehearsal checklist.
