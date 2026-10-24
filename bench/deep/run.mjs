#!/usr/bin/env node
// Deep benchmarks: safeguards, triage/extraction, and the Kane gate under fault injection.
// No Kane credits, no OpenAI, no running server needed. Writes bench/deep/results.md and results.json.
//   node bench/deep/run.mjs            (GATE_RANDOM=200 random fix-loop sequences by default)
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runPolicy } from './policy.mjs';
import { runGate, gateMarkdown } from './gate.mjs';

const started = Date.now();
const randomCases = Number(process.env.GATE_RANDOM || 200);
const { safeguards, triage, extractor } = await runPolicy();
const gate = await runGate({ randomCases });
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}
const s = safeguards.summary;
const t = triage.summary;
const scripted = gate.results.filter((r) => r.asExpected && !r.broken.some((b) => !b.startsWith('[efficiency]'))).length;
const randomSafe = gate.random.cases - gate.random.broken.filter((b) => b.broken.some((x) => !x.startsWith('[efficiency]'))).length;

const md = [
  '# Seyrin deep benchmarks',
  '',
  `Run ${new Date().toISOString()} at commit \`${commit}\`, in ${((Date.now() - started) / 1000).toFixed(0)} s, with \`node bench/deep/run.mjs\`. Extractor: ${extractor || 'heuristic'}. **No real Kane and no OpenAI were used**: these benchmarks score Seyrin's own logic around them. The real Kane runs are in \`bench/results.md\` and on the Proof tab.`,
  '',
  'The emails are synthetic and were written for this benchmark by someone who had read the rules; read the numbers as a stress test, not a field accuracy rate. See `bench/deep/README.md` for what each result means.',
  '',
  '| Benchmark | Headline | Sample |',
  '|---|---|---|',
  `| 1. Safeguards | ${s.attacksPassed} / ${s.attacks} attacks handled as claimed; ${s.ranUnattended} would have run without approval; ${s.falseRefusals} / ${s.benign} legitimate requests wrongly refused; ${s.objectiveLeaks} attack strings reached Kane | ${s.attacks} attacks, ${s.benign} legitimate |`,
  `| 2. Triage and extraction | ${t.kindCorrect} / ${t.labelled} task types right (${t.unseenCorrect} / ${t.unseen} on new mail); ${t.fieldsCorrect} / ${t.fields} extracted fields right | ${t.labelled} labelled emails |`,
  `| 3. Kane gate, fault injection | ${scripted} / ${gate.results.length} scripted scenarios as expected; ${randomSafe} / ${gate.random.cases} random sequences kept every safety rule | ${gate.results.length + gate.random.cases} task runs |`,
  '',
  safeguards.md,
  triage.md,
  gateMarkdown(gate),
].join('\n');
writeFileSync(new URL('./results.md', import.meta.url), md + '\n');
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), commit, extractor, safeguards: { summary: s, cases: safeguards.cases, benign: safeguards.benign }, triage: { summary: t, checks: triage.checks }, gate }, null, 2) + '\n');
console.log(md);
