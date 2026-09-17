---
name: git-workflow
description: Use whenever creating a branch, committing, pushing, opening a pull request, rebasing, or merging in this repository — including implicitly, whenever a task like "implement phase 2" or "fix the login bug" requires any of those actions, not just when git is mentioned explicitly. Enforces phase-based branch naming tied to docs/plan/, Conventional Commit messages, rebase-before-merge, squash-merge by default, and a strictly linear history on main.
---

# Git Workflow

This repo runs on one non-negotiable rule: **`main` only moves forward via merged, rebased, CI-green branches — never a direct commit, never a merge commit.** Everything below exists to make that true automatically, every time, without waiting for a human to remember to ask for it.

## Branch naming
- Implementing a phase from the implementation plan: `phase-<n>-<slug>`, matching the file it implements — `phase-2-data-layer` for `docs/plan/phase-2-data-layer.md`.
- Anything else (a hotfix, a chore between phases): `fix/<slug>` or `chore/<slug>`.
- All lowercase, hyphen-separated. No spaces, no underscores, no `feature/` prefix noise — the phase number already tells the story.
- One phase in flight at a time by default, merged before the next begins, matching the dependency order the implementation plan already established. Only run phases in parallel when they're genuinely independent (no shared files, no shared decisions) — that's the exception, not the default.

## The lifecycle

**1. Sync before doing anything else.**
```
scripts/sync-and-branch.sh <branch-name>
```
This checks out `main`, fast-forward-pulls it, and only then cuts the new branch. If the fast-forward pull fails, the script stops — that means local and remote `main` have diverged, which shouldn't happen under this workflow. Investigate before branching; don't force past it.

**2. Commit as you go**, using Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`) — one logical change per commit, committed at every real checkpoint, not batched into one giant commit at the end. This is the same commit point the implementation plan's "Handoff" section refers to at the end of each phase.

**3. Before pushing, run the full local check** — whatever this project's tests/lint/build actually are. Don't push code you haven't verified.

**4. Push and open the PR.**
```
git push -u origin <branch-name>
```
PR description, every time:
```
## What
<one-line summary>

## Which phase / spec
Implements `docs/plan/phase-<n>-<slug>.md`.
Touches: `docs/specs/<relevant-spec>.md`

## How verified
<tests run, manual checks>
```

**5. Keep the branch current by rebasing — never by merging `main` into it.**
```
git fetch origin
git rebase origin/main
```
Resolve conflicts file by file, re-run tests once resolved, then:
```
git push --force-with-lease
```
Never a plain `--force`. `--force-with-lease` refuses to overwrite anything you haven't already seen; a bare `--force` would silently clobber it.

**6. Merge only once CI is green *and* the branch is rebased onto the latest `main`.**
- Default: **squash-merge.** The branch collapses into one clean commit on `main` — that's what keeps `git log --oneline main` reading as one line per phase.
- Use rebase-merge (commits preserved individually) only when a phase's internal commit history is itself worth keeping for future debugging.
- Never a plain merge commit. If the remote's UI defaults to "create a merge commit," pick "squash and merge" or "rebase and merge" explicitly instead.

**7. Clean up immediately after merge.**
```
scripts/finish-phase.sh <branch-name>
```
Deletes the branch locally and on the remote, then re-syncs local `main`. A merged branch has no further use — leaving it around just clutters the branch list.

## Stop and flag a human instead of guessing, when:
- A rebase conflict touches something genuinely high-stakes — a migration, an auth check, anything where a wrong guess could corrupt data or open a security gap. Resolve whatever's unambiguous; flag the rest with the exact lines in question.
- CI fails for a reason that has nothing to do with this branch's own changes (flaky infra, a dependency outage) — don't force through by disabling the check.
- Two in-flight phases keep touching the same files — that's usually a sign the phase boundaries in `docs/plan/` were wrong, which is a planning problem, not a git problem.

## Never, under this workflow:
- A direct commit to `main`.
- `git push --force` (only `--force-with-lease`, and only on your own branch — never on `main`).
- A merge commit of any kind.
- Merging with CI red.
- Rewriting or deleting `main`'s history.
