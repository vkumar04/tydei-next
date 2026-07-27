# Rollback: payor-margin dates + admin dashboard reads

Break-glass procedure for `fix/payor-margin-dates-and-users-bounce`
(two commits: rate `effectiveDate` carry-through, and the admin dashboard
Route Handler).

## Known-good state

```
rollback/known-good-pre-payor-dashboard  ->  3cda580a
```

Pushed to origin, so it survives anything that happens to `main`. That commit
is `main` as of 2026-07-26, after PR #165 and before this branch.

## Rolling back

PRs here are **squash**-merged, so each lands as a single ordinary commit —
not a merge commit. Reverting is therefore the plain form, with no `-m 1`:

```bash
git checkout main && git pull
git revert --no-edit <squash-sha>     # the "(#NNN)" commit for this branch
git push
```

Railway redeploys `main` automatically; no further action.

**This was rehearsed, not assumed.** The squash merge was simulated on a
scratch branch, reverted, and the resulting tree compared against
`3cda580a` — byte-identical, no conflicts.

If you would rather not carry a revert commit, resetting works too, but only
if nothing else has landed on `main` since:

```bash
git checkout main
git reset --hard rollback/known-good-pre-payor-dashboard
git push --force-with-lease
```

Prefer the revert. It keeps history honest and is safe when other work has
landed.

## What is in the change, so you can judge blast radius

**Commit 1 — `payor-margin` effective dates.** Read-path only. Carries
`effectiveDate` from stored `cptRates` into the rate lookup, which had been
dropped. Affects the payor-margin summary surface. Validated against a
production snapshot: the multi-year Anthem contract moves
`estReimbursement` from $4,255,789 to $4,514,598 (+$258,809 across all 674
cases). The single-year contract is unchanged, as expected.

*Risk:* the number on that surface changes. That is the intended fix, but if
someone has been reconciling against the old figure it will look like a
regression. It is not.

**Commit 2 — admin dashboard reads via a Route Handler.** Moves three
`requireAdmin()` reads (stats, recent activity, pending actions) from Server
Actions to `GET /api/admin/dashboard`. New public endpoint, so it checks the
session and admin role itself: 401 unauthenticated, 403 non-admin, verified
across all four cases. The underlying actions still call `requireAdmin()`,
so the gate is enforced twice.

*Risk:* highest of the two. It introduces a new endpoint and changes how the
admin dashboard loads. Symptoms to watch: the dashboard panels empty or
stuck loading, or a 403 for a legitimate admin.

## Caveat on what commit 2 claims

It is a **second** attempt at the `/admin/users` bounce. The first (#165)
cut the rate from ~1 in 3 to ~1 in 12 without ending it. At the time of
merge this had 5 clean full-suite runs, which at a 1-in-12 rate is a ~65%
outcome by chance — consistent with fixed *and* with unchanged.

So if the bounce is still reported after this ships, that is **not** a new
regression and rolling back will not help. It means the hunt is unfinished.
Rollback is warranted only for the symptoms listed above.
