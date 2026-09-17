# .claude/skills — StockSync

## Portability, stated plainly

`.claude/skills/` with a `SKILL.md` frontmatter block is Claude Code's own
auto-discovery convention — Claude Code loads a skill's `description` into
context automatically and triggers the full skill when it matches. A few
other agent tools are adopting compatible conventions, but most will not
auto-trigger on this folder structure. That said, every file here is
plain, well-organized markdown (plus a few standalone Python scripts) —
any other agent, or a teammate, can be pointed at any of these files
directly and get full value from them even without the auto-discovery
mechanism.

## What's in this set, and why

Two of these skills already existed before this pass and were customized
directly for StockSync in earlier work; four are new, added specifically
because this project's specs (PRD, architecture, DB schema, edge cases,
testing strategy) revealed a real, recurring need for them. Nothing here
is a generic template — each skill's guidance is grounded in this
project's actual stack and actual already-caught bugs.

| Skill | Status | Why it's here |
|---|---|---|
| `senior-fullstack` | Existing, customized | TypeScript monorepo stack selection, the `aws-serverless-hackathon` profile, and the `aws-serverless-cdk` project scaffolder — the team's single-stack, small-team fullstack skill |
| `senior-devops` | Existing, customized | CI/CD, IaC (Terraform *and* CDK), and deployment strategy (Kubernetes blue-green/rolling *and* Lambda serverless-canary) |
| `senior-architect` | New | The project's entire pitch is a specific correctness guarantee (concurrent/offline writes merge correctly) — this skill encodes the four questions that guard it and the four real bugs already caught, so future changes don't reintroduce them |
| `senior-qa` | New | Testing this project well means property-based tests proving algebraic guarantees and a multi-browser-context E2E scenario, not just line coverage — different enough from generic QA advice to warrant its own skill |
| `senior-prompt-engineer` | New | Four distinct Bedrock-powered features exist (price-conflict explanation, NL query, reorder suggestions, voice entry), each with a real guardrail (grounded-not-general-knowledge, advisory-not-authoritative, schema-validate-before-write) worth codifying once rather than reinventing per feature |
| `aws-solution-architect` | New | The "Built on AWS" judging criterion depends on every service choice being defensible in one sentence — this skill holds that bar and keeps the stack inside the always-free tier |

### Deliberately not generated, and why

- **`senior-frontend` / `senior-backend` split** — team is small and the
  stack is a single TypeScript monorepo; `senior-fullstack` already covers
  both layers without the overhead of maintaining two skills that would
  mostly duplicate each other.
- **`senior-database`** — DynamoDB's access-pattern-driven design is
  already documented in `senior-fullstack`'s architecture reference and
  the project's own `03-DATABASE-SCHEMA.md`; not heavy enough at four
  tables to warrant splitting out.
- **`senior-ml-engineer` / `senior-data-scientist` / `senior-computer-vision`**
  — no model training exists or is planned; Bedrock is used only as a
  pre-trained foundation-model API call, which is `senior-prompt-engineer`'s
  domain, not an ML-engineering one.
- **`senior-security` / `ai-security` / `threat-detection`** — the project
  currently handles only synthetic demo data (see the
  `aws-serverless-hackathon` profile's `data_sensitivity_tier`), with no
  stated regulated-data requirement. `aws-solution-architect`'s
  least-privilege IAM guidance covers the security surface that actually
  exists today. Revisit this decision if the project moves past a demo
  and starts handling real shop/user data.
- **`code-reviewer` / `tdd-guide`** — their substance is already covered
  by `senior-architect` (review lens) and `senior-qa` (testing discipline)
  respectively; a generic version of either would mostly restate them.
- **`tech-stack-evaluator`** — the stack is already locked and documented
  in `05-TECH-STACK.md`; it isn't being second-guessed.
- **`epic-design`** — `09-BUILD-PLAN.md` already breaks the 10-day build
  into day-by-day work with exit criteria; a small/solo team doesn't need
  separate ticket-breakdown tooling on top of that.

## How these six skills refer to each other

`senior-fullstack`'s `references/composition_map.md` and `senior-devops`'s
`SKILL.md` both got small additive updates (not full rewrites) pointing at
the four new skills, so the whole set is cross-referenced rather than six
folders that don't know about each other. Each new skill's `SKILL.md`
ends with a **Hand off to** line naming which other skill in this set
should take over for an adjacent concern.

## If `.claude/skills/` already exists in your repo

This zip was built additively against an existing, already-customized
`senior-fullstack` and `senior-devops` — nothing in either was replaced
wholesale, only specific sections were extended. If you're merging this
into a repo that has further changes since this was generated, diff
before overwriting rather than extracting on top blindly.
