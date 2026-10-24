#!/usr/bin/env node
// How much time Seyrin saves, stress-tested. Reads the measured run (bench/results.json, bench/comparison.json)
// and asks three questions of it, without new Kane runs:
//   1. Range: across 10,000 draws over every step's low–high range, how much owner time is saved?
//   2. Floors: if every judgement call goes against Seyrin, how much is still saved?
//   3. Machine time: where Seyrin's measured minutes go, and how long the worst case would take.
// Human times are modeled (bench/human-model.mjs); Seyrin times are measured, from one run on 2026-10-24.
//   node bench/time/run.mjs            writes bench/time/results.md and results.json
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const comparison = read('../comparison.json');
const measured = read('../results.json');
const rates = read('../rates.json');
const config = read('../../seyrin.config.json');
const rows = comparison.rows;

const SAMPLES = 10_000;
const SEED = 20261024;
const SLOW_READER = 1.4; // the model's own high case for reading steps (spread 0.2 → +40%)
const min = (s) => s / 60;
// Same rounding as bench/compare.mjs, so totals match bench/comparison.md.
const fmt = (s) => (s >= 90 ? `${Math.round(s / 6) / 10} min` : `${Math.round(s)} s`);
const pct = (saved, base) => `${Math.round((saved / base) * 100)}%`;
const sum = (list, f = (x) => x) => list.reduce((a, x) => a + f(x), 0);
const isAssumption = (step) => /assum/i.test(step.basis);
const isRegressionTest = (step) => /regression test/i.test(step.label);

// ── 1. Range ────────────────────────────────────────────────────────────────
let s = SEED;
const rand = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
// Triangular draw between low and high with the mode at the typical value.
function tri(low, mode, high, u) {
  if (high === low) return mode;
  const c = (mode - low) / (high - low);
  return u < c ? low + Math.sqrt(u * (high - low) * (mode - low)) : high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}
function draw(correlated) {
  const person = rand(); // one quantile for a person who is fast or slow at everything
  let human = 0;
  for (const row of rows) for (const st of row.human.steps) human += tri(st.low, st.typical, st.high, correlated ? person : rand());
  // Reading Seyrin's card and reply: 0.8× to 1.4× the typical time, the same spread the model gives reading steps.
  const speed = 0.8 + (correlated ? person : rand()) * 0.6;
  const attention = sum(rows, (r) => r.seyrin.attentionSeconds) * speed;
  return { human, attention, saved: human - attention, share: (human - attention) / human };
}
const quantile = (list, q) => list[Math.min(list.length - 1, Math.floor(q * list.length))];
function range(correlated) {
  const draws = Array.from({ length: SAMPLES }, () => draw(correlated));
  const by = (k) => draws.map((d) => d[k]).sort((a, b) => a - b);
  const out = {};
  for (const k of ['human', 'attention', 'saved', 'share']) {
    const sorted = by(k);
    out[k] = { p5: quantile(sorted, 0.05), p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95), min: sorted[0], max: sorted.at(-1) };
  }
  return out;
}
const independent = range(false);
const correlated = range(true);

// ── 2. Floors ───────────────────────────────────────────────────────────────
const words = (text) => text.split(/\s+/).filter(Boolean).length;
const readSeconds = (n) => (n / rates.readingWpm) * 60;
const CLICK = rates.klm.M + rates.klm.H + rates.klm.P + rates.klm.B;
// A careful owner who checks Seyrin's work instead of trusting the card. All three are assumptions.
const DOC_WORDS = 300; // the same length the human model writes
const DIFF_REVIEW = 60; // seconds to read a one- or two-line diff and decide it is right
const SHOT_LOOK = 10; // seconds to open Kane's screenshot and look at it
function carefulExtra(row) {
  let extra = CLICK + SHOT_LOOK;
  if (row.kind === 'document') extra += readSeconds(DOC_WORDS) + CLICK;
  if (row.kind === 'site_change' || (row.kind === 'bug_report' && row.outcome === 'done')) extra += DIFF_REVIEW;
  return extra;
}
const ladder = [];
const rung = (label, why, humanStep, attention) => {
  const human = sum(rows, (r) => sum(r.human.steps.filter(humanStep.keep), humanStep.value));
  const att = sum(rows, attention);
  ladder.push({ label, why, human, attention: att, saved: human - att, share: (human - att) / human });
};
rung('As published', 'Typical time for every step (bench/comparison.md)', { keep: () => true, value: (st) => st.typical }, (r) => r.seyrin.attentionSeconds);
rung('No regression tests', 'Assume the person would not write a test (2 × 15 min removed)', { keep: (st) => !isRegressionTest(st), value: (st) => st.typical }, (r) => r.seyrin.attentionSeconds);
rung('…and a fast person', 'Every remaining step at its low case', { keep: (st) => !isRegressionTest(st), value: (st) => st.low }, (r) => r.seyrin.attentionSeconds);
rung('…and only published rates', 'Also drop every step priced by an assumption (finding and fixing the bug, planning, gathering facts)', { keep: (st) => !isRegressionTest(st) && !isAssumption(st), value: (st) => st.low }, (r) => r.seyrin.attentionSeconds);
rung('…and a careful, slow owner', `Owner also reads the whole doc, reviews each diff (${DIFF_REVIEW} s), opens Kane's screenshot, all at ${SLOW_READER}× reading time`, { keep: (st) => !isRegressionTest(st) && !isAssumption(st), value: (st) => st.low }, (r) => (r.seyrin.attentionSeconds + carefulExtra(r)) * SLOW_READER);

// ── 3. Machine time ─────────────────────────────────────────────────────────
const byKind = Object.fromEntries(measured.tasks.map((t) => [t.subject, t]));
const machine = rows.map((r) => {
  const t = byKind[r.subject];
  const kane = (t.firstKaneRunSeconds || 0) + (t.kaneRuns > 1 ? t.verifiedRunSeconds || 0 : 0);
  return { subject: r.subject, kind: r.kind, outcome: r.outcome, total: r.seyrin.machineSeconds, kane, other: r.seyrin.machineSeconds - kane, runs: t.kaneRuns, firstVerdict: t.firstVerdictSeconds, human: r.human.typical };
});
const runTimes = measured.tasks.flatMap((t) => [t.firstKaneRunSeconds, t.kaneRuns > 1 ? t.verifiedRunSeconds : null]).filter((x) => x != null);
const slowestRun = Math.max(...runTimes, ...measured.replays.map((r) => r.replaySeconds));
const timeout = config.server.runTimeoutSeconds;
// Worst case: every document and code change needs all 3 attempts; every bug report is reproduced first.
const worstRuns = sum(rows, (r) => (r.kind === 'document' || r.kind === 'site_change' ? 3 : r.outcome === 'done' ? 4 : 1));
const otherTotal = sum(machine, (m) => m.other);

// ── Report ──────────────────────────────────────────────────────────────────
const humanTypical = ladder[0].human;
const attTypical = ladder[0].attention;
const md = [];
md.push('# How much time Seyrin saves', '');
md.push(`Built ${new Date().toISOString()} from the measured run of ${comparison.measuredAt} (\`bench/results.json\`, \`bench/comparison.json\`) with \`node bench/time/run.mjs\`. No new Kane runs. **By-hand times are modeled** from published rates and labelled assumptions (\`bench/human-model.mjs\`). **Seyrin's times are measured**, from one run of each of the ${rows.length} demo tasks. "Owner time" is what you still spend with Seyrin: reading its card, approving, and sending the drafted reply.`, '');
md.push('## Headline', '');
md.push('| | By hand | With Seyrin (owner time) | Saved |', '|---|---|---|---|');
md.push(`| As published | ${fmt(humanTypical)} | ${fmt(attTypical)} | **${fmt(humanTypical - attTypical)} (${pct(humanTypical - attTypical, humanTypical)})** |`);
md.push(`| Middle of 10,000 draws (independent steps) | ${fmt(independent.human.p50)} | ${fmt(independent.attention.p50)} | ${fmt(independent.saved.p50)} (${Math.round(independent.share.p50 * 100)}%) |`);
md.push(`| 5th percentile, fast person (correlated steps) | ${fmt(correlated.human.p5)} | ${fmt(correlated.attention.p5)} | ${fmt(correlated.saved.p5)} (${Math.round(correlated.share.p5 * 100)}%) |`);
const floor = ladder.at(-1);
md.push(`| Floor: everything against Seyrin (not a realistic person, see section 2) | ${fmt(floor.human)} | ${fmt(floor.attention)} | ${fmt(floor.saved)} (${pct(floor.saved, floor.human)}) |`, '');
md.push(`Per request, as published: ${fmt((humanTypical - attTypical) / rows.length)} of owner time saved on average across these ${rows.length}. Seyrin's own machine time for all ${rows.length} was ${fmt(sum(machine, (m) => m.total))}, unattended.`, '');

md.push('## 1. Range: how sure is the saving?', '');
md.push(`Every by-hand step in the model has a low, typical and high time. Each draw picks a time for every step from a triangular distribution over that range, and scales owner reading time between 0.8× and ${SLOW_READER}× (the model's own spread for reading). ${SAMPLES.toLocaleString()} draws, seed ${SEED}. "Independent" lets each step vary on its own. "Correlated" uses one draw per person, so a fast person is fast at everything; that is the less favourable case for Seyrin.`, '');
md.push('| Draws | By hand (P5 / median / P95) | Owner time with Seyrin (P5 / median / P95) | Saved (P5 / median / P95) | Lowest saving in any draw |', '|---|---|---|---|---|');
for (const [name, r] of [['Independent', independent], ['Correlated', correlated]]) {
  md.push(`| ${name} | ${fmt(r.human.p5)} / ${fmt(r.human.p50)} / ${fmt(r.human.p95)} | ${fmt(r.attention.p5)} / ${fmt(r.attention.p50)} / ${fmt(r.attention.p95)} | ${fmt(r.saved.p5)} / ${fmt(r.saved.p50)} / ${fmt(r.saved.p95)} | ${fmt(r.saved.min)} (${Math.round(r.share.min * 100)}%) |`);
}
md.push('', 'The range only moves the by-hand estimate within the bounds the model already states. It does not test whether those bounds are right; section 2 does that by removing parts of the model. The median is above the published typical time because each step\'s high case is further from typical than its low case.', '');

md.push('## 2. Floors: if every call goes against Seyrin', '');
md.push('Each row keeps the previous row\'s cuts and adds one more.', '');
md.push('| Case | What changes | By hand | Owner time with Seyrin | Saved |', '|---|---|---|---|---|');
for (const r of ladder) md.push(`| ${r.label} | ${r.why} | ${fmt(r.human)} | ${fmt(r.attention)} | **${fmt(r.saved)} (${pct(r.saved, r.human)})** |`);
md.push('', `The last row is not a realistic person: it assumes the bugs take no time to find or fix, because those steps are priced by assumption, not by a published rate. It shows that even the parts of the job that can be priced from published typing, reading and clicking rates alone (opening the page, retrying, typing the doc and the replies) take more of the owner's time than checking Seyrin's work does. The careful-owner times (${DIFF_REVIEW} s per diff, ${SHOT_LOOK} s per screenshot, reading the whole ${DOC_WORDS}-word doc) are assumptions.`, '');

md.push('## 3. Machine time: where Seyrin\'s minutes go', '');
md.push('Measured from task timestamps and Kane\'s NDJSON. "Kane" is the sum of Kane run times; "everything else" is understanding the email, the agent writing or fixing, and Seyrin\'s own work. Time waiting for your approval is excluded.', '');
md.push('| Request | Seyrin, email → verified | Kane runs | Kane time | Everything else | First Kane verdict | By hand (typical) |', '|---|---|---|---|---|---|---|');
for (const m of machine) md.push(`| ${m.subject} (${m.kind.replace('_', ' ')}, ${m.outcome.replace('_', ' ')}) | ${fmt(m.total)} | ${m.runs} | ${fmt(m.kane)} | ${fmt(m.other)} | ${fmt(m.firstVerdict)} | ${fmt(m.human)} |`);
md.push(`| **All ${machine.length}** | **${fmt(sum(machine, (m) => m.total))}** | ${sum(machine, (m) => m.runs)} | ${fmt(sum(machine, (m) => m.kane))} (${pct(sum(machine, (m) => m.kane), sum(machine, (m) => m.total))}) | ${fmt(otherTotal)} | | ${fmt(humanTypical)} |`, '');
md.push(`Kane's browser runs are ${pct(sum(machine, (m) => m.kane), sum(machine, (m) => m.total))} of Seyrin's machine time, and none of it needs you. Every task above passed on the agent's first attempt.`, '');
md.push(`**Worst case.** Suppose every document and code change needed all 3 attempts and every bug was reproduced first: ${worstRuns} Kane runs instead of ${sum(machine, (m) => m.runs)}. Then:`, '');
md.push('| Each Kane run takes | All 5 tasks, machine time | By hand (typical) |', '|---|---|---|');
md.push(`| The slowest run measured today (${fmt(slowestRun)}) | ${fmt(worstRuns * slowestRun + otherTotal * 3)} | ${fmt(humanTypical)} |`);
md.push(`| Seyrin's run timeout (${fmt(timeout)}, every run hits it) | ${fmt(worstRuns * timeout + otherTotal * 3)} | ${fmt(humanTypical)} |`, '');
md.push(`"Everything else" is tripled for the retries. Owner time does not change in either case, because the retries run unattended; a task that still fails after 3 attempts comes back to you, and that time is not modeled here.`, '');

md.push('## Limits', '');
md.push(`- One measured run per task (${rows.length} tasks, ${sum(machine, (m) => m.runs)} Kane runs). Kane run times measured today ranged from ${fmt(Math.min(...runTimes, ...measured.replays.map((r) => r.replaySeconds)))} to ${fmt(slowestRun)}, so Seyrin's totals would move between runs.`);
md.push('- By-hand times are a model. No one was timed doing these tasks by hand yet (`node bench/stopwatch.mjs` exists for that).');
md.push('- The tasks are the demo inbox on Perch, a small app with one-line bugs. Bigger codebases make the by-hand fix slower and the agent\'s first attempt less likely to pass.');
md.push('- Interruptions are left out on both sides. They would favour Seyrin; the model does not count them.', '');

writeFileSync(new URL('./results.md', import.meta.url), md.join('\n'));
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ builtAt: new Date().toISOString(), measuredAt: comparison.measuredAt, samples: SAMPLES, seed: SEED, range: { independent, correlated }, ladder, machine, worst: { runs: worstRuns, slowestRun, timeout, otherTotal } }, null, 2) + '\n');
console.log(md.join('\n'));
