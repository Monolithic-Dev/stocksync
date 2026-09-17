# StockSync — Documentation Index

This is the full documentation set for **StockSync**: an offline-first
inventory sync engine for multi-counter kirana stores, built for the AWS
First Commit hackathon (Ship It track).

Read in this order if you're new to the project. If you're feeding this
to Claude Code as build context, feed **02, 03, and 04 together** first —
that's the trio that determines the actual code shape — then 06 for the
folder layout, then work through 09 day by day.

| # | Document | What it's for |
|---|---|---|
| 01 | `01-PRD.md` | The full product requirements — problem, scope, functional and non-functional requirements, user stories, acceptance criteria. Read this first to understand *what* and *why*. |
| 02 | `02-ARCHITECTURE.md` | The system design — every AWS service, every data flow, the conflict-resolution algorithm, security, and failure modes. This is the technical heart of the project. |
| 03 | `03-DATABASE-SCHEMA.md` | Every DynamoDB table, its access patterns, keys, and item shapes. |
| 04 | `04-API-SPEC.md` | Every REST endpoint and WebSocket message, with full request/response contracts. |
| 05 | `05-TECH-STACK.md` | The chosen stack and why, given the monorepo and 10-day constraint. |
| 06 | `06-FOLDER-STRUCTURE.md` | The monorepo layout, and the reasoning behind the most important structural decision (the `packages/core` split). |
| 07 | `07-EDGE-CASES.md` | A deliberate catalog of edge cases across concurrency, networking, security, and UI — reference this while implementing, not just before. |
| 08 | `08-TESTING-STRATEGY.md` | What gets unit-tested, integration-tested, and e2e-tested, and why the conflict-resolution logic specifically needs property-based tests. |
| 09 | `09-BUILD-PLAN.md` | The day-by-day, 10-day execution plan with exit criteria for each day. |
| 10 | `10-DEMO-PLAN.md` | The exact demo script and rehearsal checklist for the 3-minute submission video. |

## How to work with this as a solo/small team using Claude Code

- Start every new coding session by pointing Claude Code at the specific
  doc(s) relevant to what you're building that session — don't rely on it
  remembering the whole set from a prior session's context.
- Treat `02-ARCHITECTURE.md` and `04-API-SPEC.md` as the source of truth.
  If you change an API contract or a data model while building, update
  the doc in the same sitting — a stale spec is worse than no spec,
  because it actively misleads later generations of code.
- `07-EDGE-CASES.md` is meant to be revisited, not just read once — when
  you implement a handler, check which edge cases apply to it and
  confirm they're handled before moving on.
