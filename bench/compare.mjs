#!/usr/bin/env node
// Human (modeled) vs Seyrin (measured) for every task the server ran. Writes bench/comparison.md and .json.
import { writeFileSync } from 'node:fs';
import { humanSteps, seyrinAttention, SOURCES, RATES } from './human-model.mjs';

const server = process.env.SEYRIN_URL || 'http://127.0.0.1:4477';
const { tasks } = await (await fetch(`${server}/v1/tasks`)).json();
const ms = (s) => Date.parse(s);
const fmt = (s) => (s == null ? '–' : s >= 90 ? `${Math.round(s / 6) / 10} min` : `${Math.round(s)} s`);

const rows = [];
for (const task of tasks.filter((t) => ['done', 'not_reproduced'].includes(t.phase))) {
  const steps = humanSteps(task);
  const human = ['low', 'typical', 'high'].map((k) => steps.reduce((sum, s) => sum + s[k], 0));
  const lastRun = task.runs.filter((r) => r.endedAt).at(-1);
  const end = ms(lastRun?.endedAt || task.updatedAt);
  // Machine time only: subtract the time Seyrin sat waiting for a person to approve.
  let waiting = 0;
  for (const approval of task.log.filter((l) => /^You approved/.test(l.text))) {
    const asked = task.log.filter((l) => ms(l.ts) <= ms(approval.ts) && /^(Waiting for your approval|Reproduced:)/.test(l.text)).at(-1);
    if (asked) waiting += ms(approval.ts) - ms(asked.ts);
  }
  const seyrinMachine = (end - ms(task.createdAt) - waiting) / 1000;
  const attention = seyrinAttention(task);
  const seyrinHuman = attention.reduce((sum, s) => sum + s.seconds, 0);
  rows.push({ subject: task.email.subject, kind: task.kind, outcome: task.phase, human: { low: human[0], typical: human[1], high: human[2], steps }, seyrin: { machineSeconds: Math.round(seyrinMachine), attentionSeconds: seyrinHuman, attention, kaneRuns: task.runs.length, verified: Boolean(task.result?.verified) || task.phase === 'not_reproduced' } });
}

const total = (f) => rows.reduce((sum, r) => sum + f(r), 0);
const humanTotal = total((r) => r.human.typical);
const attentionTotal = total((r) => r.seyrin.attentionSeconds);
const machineTotal = total((r) => r.seyrin.machineSeconds);
const md = [
  '# Human vs Seyrin',
  '',
  '**Human times are modeled, not measured.** Each step is built from published rates (KLM operator times, reading and composing speed) or a labelled assumption; the range is the low and high case. **Seyrin times are measured** from this run\'s task timestamps and Kane NDJSON. "Your attention" is the modeled time you still spend reading Seyrin\'s card, approving and sending.',
  '',
  '| Request | By hand (typical, range) | Seyrin end to end (measured) | Your attention with Seyrin | Attention saved |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.subject} (${r.kind.replace('_', ' ')}, ${r.outcome.replace('_', ' ')}) | ${fmt(r.human.typical)} (${fmt(r.human.low)}–${fmt(r.human.high)}) | ${fmt(r.seyrin.machineSeconds)}, ${r.seyrin.kaneRuns} Kane run${r.seyrin.kaneRuns === 1 ? '' : 's'} | ${fmt(r.seyrin.attentionSeconds)} | ${Math.round((1 - r.seyrin.attentionSeconds / r.human.typical) * 100)}% |`),
  `| **All ${rows.length} tasks** | **${fmt(humanTotal)}** | **${fmt(machineTotal)}** | **${fmt(attentionTotal)}** | **${Math.round((1 - attentionTotal / humanTotal) * 100)}%** |`,
  '',
  'Every Seyrin result above was checked by Kane in a real browser before it was called done. The by-hand times assume no interruption; resuming interrupted work averages 23 min 15 s (Mark et al.), which a person handling inbox requests pays far more often than Seyrin.',
  '',
  '## How the by-hand times are built',
  '',
  `Rates (bench/rates.json): reading ${RATES.readingWpm} wpm, copying ${RATES.transcribeWpm} wpm, composing ${RATES.composeWpm} wpm, KLM keystroke ${RATES.klm.K} s, point ${RATES.klm.P} s, click ${RATES.klm.B} s, home ${RATES.klm.H} s, mental preparation ${RATES.klm.M} s.`,
  '',
  ...Object.entries(RATES.notes).map(([k, v]) => `- **${k}:** ${v}`),
  `- **Hayes & Flower (1980)** describe writing as planning, translating and reviewing; the model gives the structure, the durations above are estimates.`,
  '',
  ...rows.flatMap((r) => [`### ${r.subject}`, '', '| Step | Typical | Basis |', '|---|---|---|', ...r.human.steps.map((s) => `| ${s.label} | ${fmt(s.typical)} | ${s.basis} |`), '']),
  '## Sources',
  '',
  ...SOURCES.map(([label, url]) => `- [${label}](${url})`),
  '',
].join('\n');
writeFileSync(new URL('./comparison.md', import.meta.url), md);
writeFileSync(new URL('./comparison.json', import.meta.url), JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2) + '\n');
console.log(md.split('## How')[0]);
