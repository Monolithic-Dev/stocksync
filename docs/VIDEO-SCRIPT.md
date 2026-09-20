# StockSync — 3-Minute Demo Video Script

The video is done: **`demo-assets/stocksync-full-tour.mp4`** (also
`.webm`), at the repo root, gitignored. It's a real, automated 2:59
recording — dark mode throughout, an animated visible cursor for every
click and hover, and genuine data at every step (real stock arithmetic,
a real price conflict, a real completed checkout). Nothing here is
freeze-framed or stretched — the full 3 minutes is real screen time, in
the order below. You just need to add your voice.

**Timestamp precision:** four points are exact, read directly off the
file: **0:00**, **0:42** (end of the intro), **2:04** (end of the
two-counter demo), and **3:00** (end). Everything in between is
sequenced correctly (I wrote the automation, so the order is certain)
but the seconds are reasonable estimates, not frame-measured — page
loads and network calls don't take identical time on every run. Watch
the video once with this script open and nudge your narration to match
what you actually see; don't read it as a stopwatch drill.

---

## Segment 1 — Hero, dark mode, sign-in, counter picker (0:00–0:42)

**0:00–0:08 — Hook + dark mode**
Hero page loads in light mode, headline animates in, then the cursor
moves to the theme toggle (top right) and clicks it — the whole page
switches to dark.

> "This is StockSync — an offline-first inventory sync engine for shops
> running more than one billing counter. And yes, it supports dark
> mode."

**0:08–0:20 — Design tour**
Cursor scrolls down through the "How it works" steps and the feature
grid (offline-first, conflict-free merge, real-time sync, AI-assisted
review, real multi-tenant auth, barcode quick-entry).

> "Two counters can go offline, sell the same item, restock it, change
> its price — in any order, for any duration — and when they reconnect,
> the stock always converges to one correct number. Every one of these
> pieces is real: real auth, real AI review, real barcode scanning."

**0:20–0:38 — Sign in + counter picker**
Cursor clicks the email field, types it out; clicks the password field,
types it out; clicks "Sign in." The counter picker appears; the cursor
hovers "Counter B" briefly, then clicks "Counter A."

> "Signing in is real Cognito authentication — this account owns a real
> shop. Once you're in, you pick which physical counter this browser
> session is."

**0:38–0:42 — Counter A glance**
The item grid loads — Bread, Milk, Parle-G, Rice — cursor glances over
a couple of cards and the barcode-scan button.

> "Four items, seeded with real stock and prices. Let's break it."

---

## Segment 2 — The two-counter conflict demo, side by side (0:42–2:04)

**0:42–1:00 — Both counters sign in, side by side**
Two windows, side by side: the left signs in and picks Counter A, the
right signs in and picks Counter B — same shop account, two sessions,
both switch to dark mode independently.

> "Here's the real test: two windows, same shop, different counters.
> Counter A on the left, Counter B on the right."

**1:00–1:05 — Both go offline**
Both connectivity toggles get clicked — both badges flip from green
"Online" to red "Offline."

> "Both go offline — right now, live. Neither can see the other."

**1:05–1:15 — Selling while offline**
Counter A's "Sell 1" gets clicked five times, pauses, then two more.
Counter B's "Sell 1" gets clicked three times. Stock numbers drop
independently on each side.

> "Counter A sells 5, then 2 more. Counter B sells 3. Both counting down
> from the same starting stock, with zero visibility into each other."

**1:15–1:20 — Reconnect**
Both toggles get clicked back to "Online"; both pages refresh.

> "Reconnect both — right now."

**1:20–1:26 — Arithmetic proof**
The stock number settles at **40** on both screens simultaneously.

> "Fifty, minus five, minus two, minus three — forty. On both screens.
> Every sale counted, nothing silently overwritten."

**1:26–1:32 — Audit trail**
Cursor clicks "parle-g" under the audit trail section on Counter A —
the sale history expands, showing each transaction attributed to the
right counter.

> "And the audit log proves it — every sale, correctly attributed, in
> the order it actually happened."

**1:32–1:38 — Setting up the hard case**
Both counters toggle offline again.

> "Now the case that can't be auto-merged."

**1:38–1:45 — Concurrent price edits**
Counter A's price field gets clicked and set to **₹15**; Counter B's
price field gets clicked and set to **₹18**.

> "Both counters set a different price for the same item, while both are
> offline."

**1:45–1:50 — Reconnect**
Both toggles click back online.

> "Reconnect."

**1:50–2:04 — The conflict banner**
An amber "Needs your review" banner appears on Counter A, showing both
candidate values — ₹15 from counter_a, ₹18 from counter_b — with a
"Generating explanation…" line where Amazon Bedrock's plain-language
summary would appear.

> "StockSync never guesses on a genuine conflict. It flags it for a
> human, shows both real values, and calls Amazon Bedrock to explain the
> disagreement in plain language — advisory only, it never decides for
> you."

_If Bedrock's explanation has actually rendered by the time you record
this (it depends on account access clearing), read the generated text
instead of "calls Bedrock to explain" — say what's actually on screen._

---

## Segment 3 — Products, Checkout, Dashboard, Staff (2:04–3:00)

**2:04–2:12 — Back in, single window**
A fresh sign-in as Counter A, straight to the item grid, dark mode.

> "That's the core engine. Everything past here is the product built on
> top of it."

**2:12–2:20 — Products**
Cursor clicks "Products" in the nav; the catalog table appears — name,
SKU, category, supplier, price.

> "A real product catalog — categories, suppliers, pricing — all backed
> by the same DynamoDB tables."

**2:20–2:32 — Checkout**
Cursor clicks "Checkout"; two product cards get clicked to add them to
the cart; "Complete checkout" gets clicked; a real order confirmation
and toast notification appear.

> "Checkout builds a real cart and submits it — and it goes through the
> exact same write pipeline as a manual sale. Same guarantees, same
> conflict resolution, zero special-casing."

**2:32–2:42 — Dashboard**
Cursor clicks "Dashboard"; the trust-score, revenue, and low-stock cards
are visible — the trust score reflects the real conflict from Segment 2.

> "The owner's dashboard — daily revenue, and a trust score that
> reframes the conflict rate as a business signal, not just an internal
> correctness number. Right now it's showing the exact conflict we just
> caused."

**2:42–2:49 — Staff**
Cursor clicks "Staff"; an email gets typed into the invite field; the
role dropdown gets set to "Manager."

> "And owners can invite real staff accounts — managers, counter staff —
> each with their own scoped permissions, enforced server-side, not just
> hidden in the UI."

**2:49–3:00 — Close**
Held on the Staff page as the final frame.

> "That's StockSync — offline-first, mathematically correct, and a
> complete product around it. Live on AWS today."

---

## If you want a shorter cut

The single most important 45 seconds, if you ever need a trimmed version:
**1:00–1:26** (offline → sell → reconnect → arithmetic) plus **1:50–2:04**
(the conflict banner). That's the whole correctness claim proven twice,
back to back.
