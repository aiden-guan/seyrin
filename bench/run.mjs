#!/usr/bin/env node
// Seyrin mini benchmarks. Numbers come from the running server's task timestamps and Kane's NDJSON,
// and from timing saved-flow replays against fresh authoring. Writes bench/results.json and results.md.
// Usage: node bench/run.mjs [--no-kane]   (--no-kane skips the replay/authoring runs)
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = process.env.SEYRIN_URL || 'http://127.0.0.1:4477';
const secs = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 1000);

// 1. Tasks: email → verdict, fix → verified, attempts, gating.
const { tasks } = await (await fetch(`${server}/v1/tasks`)).json();
const rows = tasks.map((t) => {
  const runs = t.runs.filter((r) => r.endedAt);
  const first = runs[0];
  const passed = runs.findLast((r) => r.runEnd?.status === 'passed');
  // Human waiting time is not Seyrin's time: measure work from the last approval, when there was one.
  const approved = t.log.findLast((l) => /^You approved/.test(l.text));
  return {
    kind: t.kind,
    subject: t.email.subject,
    decision: t.policy.decision,
    phase: t.phase,
    kaneRuns: runs.length,
    firstVerdictSeconds: first ? secs(t.createdAt, first.endedAt) : null,
    firstKaneRunSeconds: first ? secs(first.startedAt, first.endedAt) : null,
    verifiedRunSeconds: passed ? secs(passed.startedAt, passed.endedAt) : null,
    approvedToVerifiedSeconds: approved && passed ? secs(approved.ts, passed.endedAt) : null,
    fixAttempts: t.work?.attempts?.length ?? 0,
    gated: runs.length > 0,
  };
});
const actionable = rows.filter((r) => r.decision !== 'refuse');
const gated = actionable.filter((r) => r.gated).length;

// 2. Re-check cost: replay saved flows vs author the same check fresh.
function kane(args, cwd) {
  return new Promise((done) => {
    const start = Date.now();
    const child = spawn('kane-cli', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, KANE_CLI_USER_AGENT: 'seyrin-bench' } });
    let last = null;
    createInterface({ input: child.stdout }).on('line', (l) => {
      try {
        const e = JSON.parse(l);
        if (e.type) last = e;
      } catch {}
    });
    child.on('close', (code) => done({ code, seconds: Math.round((Date.now() - start) / 100) / 10, last }));
  });
}
// --no-kane keeps the replay timings from the last full run.
const previous = existsSync(resolve(root, 'bench/results.json')) ? JSON.parse(readFileSync(resolve(root, 'bench/results.json'), 'utf8')) : {};
const replays = process.argv.includes('--no-kane') ? previous.replays || [] : [];
if (!process.argv.includes('--no-kane')) {
  const dir = resolve(root, 'demo-app/.testmuai/tests');
  for (const file of readdirSync(dir).filter((f) => /^(home_start_free|signup_basic|pricing_plans)_test\.md$/.test(f))) {
    const objective = /## Step 1\n([^\n]+)/.exec(readFileSync(resolve(dir, file), 'utf8'))?.[1];
    const url = /https?:\/\/\S+?(?=[,\s])/.exec(objective || '')?.[0];
    process.stderr.write(`replay ${file}… `);
    const replay = await kane(['testmd', 'run', `.testmuai/tests/${file}`, '--agent', '--headless'], resolve(root, 'demo-app'));
    process.stderr.write(`${replay.seconds}s; author fresh… `);
    const fresh = await kane(['run', objective, '--url', url, '--agent', '--headless'], resolve(root, 'demo-app'));
    process.stderr.write(`${fresh.seconds}s\n`);
    replays.push({ flow: file.replace('_test.md', ''), replaySeconds: replay.seconds, replayOk: replay.code === 0, freshSeconds: fresh.seconds, freshOk: fresh.code === 0 });
  }
}

// 3. Manual baselines timed with bench/stopwatch.mjs.
const manualFile = resolve(root, 'bench/manual.json');
const manual = existsSync(manualFile) ? JSON.parse(readFileSync(manualFile, 'utf8')) : [];

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const results = {
  measuredAt: new Date().toISOString(),
  tasks: rows,
  gatedRate: { gated, actionable: actionable.length, refusedOrHeld: rows.filter((r) => r.decision !== 'auto').length },
  replays,
  replayAvg: avg(replays.map((r) => r.replaySeconds)),
  freshAvg: avg(replays.map((r) => r.freshSeconds)),
  manual,
};
writeFileSync(resolve(root, 'bench/results.json'), JSON.stringify(results, null, 2) + '\n');

const md = [
  '# Seyrin mini benchmarks',
  '',
  `Measured ${results.measuredAt} with Kane CLI and the running Seyrin server. Times come from task timestamps and Kane's NDJSON; nothing is estimated.`,
  '',
  '## Tasks',
  '',
  '| Request | Policy | Outcome | Kane runs | Email → first Kane verdict | Approved → verified done | Fix attempts |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.subject} (${r.kind.replace('_', ' ')}) | ${r.decision} | ${r.phase} | ${r.kaneRuns} | ${r.firstVerdictSeconds != null ? `${r.firstVerdictSeconds}s` : '–'} | ${r.approvedToVerifiedSeconds != null ? `${r.approvedToVerifiedSeconds}s` : r.decision === 'auto' && r.verifiedRunSeconds != null ? `${r.firstVerdictSeconds}s (no approval needed)` : '–'} | ${r.fixAttempts || '–'} |`),
  '',
  `**Gated:** ${gated} of ${actionable.length} actionable tasks ended with a Kane verdict before Seyrin called them done. ${results.gatedRate.refusedOrHeld} requests were refused or held for approval by policy.`,
  '',
  ...(replays.length
    ? ['## Re-checking: saved flow vs fresh', '', '| Flow | Replay saved `_test.md` | Author the same check fresh |', '|---|---|---|', ...replays.map((r) => `| ${r.flow} | ${r.replaySeconds}s ${r.replayOk ? '✓' : '✕'} | ${r.freshSeconds}s ${r.freshOk ? '✓' : '✕'} |`), '', `Average: **${results.replayAvg}s** replayed vs **${results.freshAvg}s** fresh.`, '']
    : []),
  '## Manual baseline',
  '',
  ...(manual.length ? ['| Task (by hand) | Time |', '|---|---|', ...manual.map((m) => `| ${m.label} | ${m.seconds}s |`)] : ['Not timed yet. Run `node bench/stopwatch.mjs "Reproduce and fix the Upgrade bug by hand"` and do it yourself.']),
  '',
].join('\n');
writeFileSync(resolve(root, 'bench/results.md'), md);
console.log(md);
