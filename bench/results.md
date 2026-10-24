# Seyrin mini benchmarks

Measured 2026-10-24T18:55:54.824Z with Kane CLI and the running Seyrin server. Times come from task timestamps and Kane's NDJSON; nothing is estimated.

## Tasks

| Request | Policy | Outcome | Kane runs | Email → first Kane verdict | Approved → verified done | Fix attempts |
|---|---|---|---|---|---|---|
| One-pager for the Acme Yoga pilot (document) | auto | done | 1 | 49s | 49s (no approval needed) | 1 |
| Upgrade button does nothing (bug report) | auto | done | 2 | 77s | 41s | 1 |
| Pro price → $15 (site change) | approve | done | 1 | 37s | 35s | 1 |
| Can't create an account with my email (bug report) | auto | done | 2 | 62s | 62s | 1 |
| Urgent: Acme deposit (document) | refuse | refused | 0 | – | – | – |
| Pricing page is blank for me (bug report) | auto | not_reproduced | 1 | 34s | 34s (no approval needed) | – |

**Gated:** 5 of 5 actionable tasks ended with a Kane verdict before Seyrin called them done. 2 requests were refused or held for approval by policy.

## Re-checking: saved flow vs fresh

| Flow | Replay saved `_test.md` | Author the same check fresh |
|---|---|---|
| home_start_free | 10.4s ✓ | 36.8s ✓ |
| pricing_plans | 66.5s ✕ | 37s ✕ |
| signup_basic | 61.3s ✓ | 59.1s ✓ |

Average: **46.1s** replayed vs **44.3s** fresh.

## Manual baseline

Not timed yet. Run `node bench/stopwatch.mjs "Reproduce and fix the Upgrade bug by hand"` and do it yourself.
