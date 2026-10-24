#!/usr/bin/env node
// Record the hero flows on the hack-day Proof tab with `kanehack report`:
// both customer bugs failing on the planted code, Seyrin's agent fixing them, the same flows passing,
// then the saved regression suite as one testrun. Needs `kanehack consent yes` and a running Seyrin.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = process.env.SEYRIN_URL || 'http://127.0.0.1:4477';
const flows = [
  ['bench/flows/upgrade_checkout_test.md', 'demo-maya-upgrade', "Maya's report: Upgrade to Pro opens checkout"],
  ['bench/flows/signup_plus_email_test.md', 'seyrin-signup-plus', "Dev's report: sign-up accepts a + email"],
];
const report = (objective, args, cwd = root) => {
  console.log(`\n▸ ${objective}`);
  const r = spawnSync('kanehack', ['report', '--objective', objective, '--', 'kane-cli', ...args, '--agent'], { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
  return r.status;
};
const get = (path) => fetch(`${server}${path}`).then((r) => r.json());
const post = (path) => fetch(`${server}${path}`, { method: 'POST' }).then((r) => r.json());

// 1. Before the fix: the customers' flows fail on the planted bugs.
for (const [file, , label] of flows) report(`${label} (before the fix)`, ['testmd', 'run', file, '--no-adaptive-heal']);

// 2. Seyrin's agent fixes each reproduced bug, and Kane verifies it inside Seyrin.
for (const [, threadId] of flows) {
  const task = await get(`/v1/tasks?threadId=${threadId}`);
  if (task.phase !== 'reproduced') {
    console.log(`  ${threadId}: ${task.phase ?? 'no task'}; skipping the fix (run npm run demo:prepare first)`);
    continue;
  }
  await post(`/v1/tasks/${task.id}/fix`);
  for (;;) {
    const t = await get(`/v1/tasks/${task.id}`);
    if (['done', 'failed', 'error'].includes(t.phase)) {
      console.log(`  ${threadId}: ${t.phase} (${t.detail})`);
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// 3. After the fix: the same flows pass.
for (const [file, , label] of flows) report(`${label} (after Seyrin's fix)`, ['testmd', 'run', file, '--no-adaptive-heal']);

// 4. The saved regression suite as one run.
report('Perch regression suite (home, sign-up, pricing)', ['testrun', 'run', '--match', 'tests/(home_start_free|signup_basic|pricing_plans)_test\\.md', '--name', 'Perch regression suite'], resolve(root, 'demo-app'));
