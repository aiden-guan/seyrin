# How much time Seyrin saves

Built 2026-10-24T23:16:51.255Z from the measured run of 2026-10-24T18:55:43.591Z (`bench/results.json`, `bench/comparison.json`) with `node bench/time/run.mjs`. No new Kane runs. **By-hand times are modeled** from published rates and labelled assumptions (`bench/human-model.mjs`). **Seyrin's times are measured**, from one run of each of the 5 demo tasks. "Owner time" is what you still spend with Seyrin: reading its card, approving, and sending the drafted reply.

## Headline

| | By hand | With Seyrin (owner time) | Saved |
|---|---|---|---|
| As published | 88.2 min | 2.5 min | **85.7 min (97%)** |
| Middle of 10,000 draws (independent steps) | 101.8 min | 2.7 min | 99.1 min (97%) |
| 5th percentile, fast person (correlated steps) | 61.2 min | 2.1 min | 59.1 min (97%) |
| Floor: everything against Seyrin (not a realistic person, see section 2) | 16.7 min | 11 min | 5.7 min (34%) |

Per request, as published: 17.1 min of owner time saved on average across these 5. Seyrin's own machine time for all 5 was 6.1 min, unattended.

## 1. Range: how sure is the saving?

Every by-hand step in the model has a low, typical and high time. Each draw picks a time for every step from a triangular distribution over that range, and scales owner reading time between 0.8× and 1.4× (the model's own spread for reading). 10,000 draws, seed 20261024. "Independent" lets each step vary on its own. "Correlated" uses one draw per person, so a fast person is fast at everything; that is the less favourable case for Seyrin.

| Draws | By hand (P5 / median / P95) | Owner time with Seyrin (P5 / median / P95) | Saved (P5 / median / P95) | Lowest saving in any draw |
|---|---|---|---|---|
| Independent | 89.1 min / 101.8 min / 115.5 min | 2.1 min / 2.7 min / 3.4 min | 86.3 min / 99.1 min / 112.8 min | 74.5 min (96%) |
| Correlated | 61.2 min / 98.7 min / 149.8 min | 2.1 min / 2.7 min / 3.4 min | 59.1 min / 96 min / 146.4 min | 43.8 min (96%) |

The range only moves the by-hand estimate within the bounds the model already states. It does not test whether those bounds are right; section 2 does that by removing parts of the model. The median is above the published typical time because each step's high case is further from typical than its low case.

## 2. Floors: if every call goes against Seyrin

Each row keeps the previous row's cuts and adds one more.

| Case | What changes | By hand | Owner time with Seyrin | Saved |
|---|---|---|---|---|
| As published | Typical time for every step (bench/comparison.md) | 88.2 min | 2.5 min | **85.7 min (97%)** |
| No regression tests | Assume the person would not write a test (2 × 15 min removed) | 58.2 min | 2.5 min | **55.7 min (96%)** |
| …and a fast person | Every remaining step at its low case | 30.6 min | 2.5 min | **28.1 min (92%)** |
| …and only published rates | Also drop every step priced by an assumption (finding and fixing the bug, planning, gathering facts) | 16.7 min | 2.5 min | **14.2 min (85%)** |
| …and a careful, slow owner | Owner also reads the whole doc, reviews each diff (60 s), opens Kane's screenshot, all at 1.4× reading time | 16.7 min | 11 min | **5.7 min (34%)** |

The last row is not a realistic person: it assumes the bugs take no time to find or fix, because those steps are priced by assumption, not by a published rate. It shows that even the parts of the job that can be priced from published typing, reading and clicking rates alone (opening the page, retrying, typing the doc and the replies) take more of the owner's time than checking Seyrin's work does. The careful-owner times (60 s per diff, 10 s per screenshot, reading the whole 300-word doc) are assumptions.

## 3. Machine time: where Seyrin's minutes go

Measured from task timestamps and Kane's NDJSON. "Kane" is the sum of Kane run times; "everything else" is understanding the email, the agent writing or fixing, and Seyrin's own work. Time waiting for your approval is excluded.

| Request | Seyrin, email → verified | Kane runs | Kane time | Everything else | First Kane verdict | By hand (typical) |
|---|---|---|---|---|---|---|
| One-pager for the Acme Yoga pilot (document, done) | 49 s | 1 | 42 s | 7 s | 49 s | 24.9 min |
| Upgrade button does nothing (bug report, done) | 2 min | 2 | 1.9 min | 5 s | 77 s | 27.3 min |
| Pro price → $15 (site change, done) | 37 s | 1 | 32 s | 5 s | 37 s | 4.8 min |
| Can't create an account with my email (bug report, done) | 2.1 min | 2 | 2 min | 5 s | 62 s | 27.4 min |
| Pricing page is blank for me (bug report, not reproduced) | 34 s | 1 | 31 s | 3 s | 34 s | 3.8 min |
| **All 5** | **6.1 min** | 7 | 5.6 min (93%) | 25 s | | 88.2 min |

Kane's browser runs are 93% of Seyrin's machine time, and none of it needs you. Every task above passed on the agent's first attempt.

**Worst case.** Suppose every document and code change needed all 3 attempts and every bug was reproduced first: 15 Kane runs instead of 7. Then:

| Each Kane run takes | All 5 tasks, machine time | By hand (typical) |
|---|---|---|
| The slowest run measured today (75 s) | 20 min | 88.2 min |
| Seyrin's run timeout (4 min, every run hits it) | 61.3 min | 88.2 min |

"Everything else" is tripled for the retries. Owner time does not change in either case, because the retries run unattended; a task that still fails after 3 attempts comes back to you, and that time is not modeled here.

## Limits

- One measured run per task (5 tasks, 7 Kane runs). Kane run times measured today ranged from 10 s to 75 s, so Seyrin's totals would move between runs.
- By-hand times are a model. No one was timed doing these tasks by hand yet (`node bench/stopwatch.mjs` exists for that).
- The tasks are the demo inbox on Perch, a small app with one-line bugs. Bigger codebases make the by-hand fix slower and the agent's first attempt less likely to pass.
- Interruptions are left out on both sides. They would favour Seyrin; the model does not count them.
