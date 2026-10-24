#!/usr/bin/env node
// Fault injection for bench/deep/gate.mjs: a coding agent that does what the plan says instead of
// thinking. NOT a real agent.
//   SCRIPTED_AGENT_PLAN  JSON file: array of 'edit' | 'noop' | 'fail', consumed one per call
//   SCRIPTED_AGENT_LOG   NDJSON file: each prompt Seyrin sent
// 'edit' appends a comment to public/pricing.js (a real diff, so Seyrin spends a Kane run on it),
// 'noop' exits 0 with no change, 'fail' exits 1 with no change.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const planFile = process.env.SCRIPTED_AGENT_PLAN;
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const action = plan.shift() ?? 'edit';
writeFileSync(planFile, JSON.stringify(plan));
appendFileSync(process.env.SCRIPTED_AGENT_LOG, JSON.stringify({ action, prompt: process.argv[2] }) + '\n');
if (action === 'edit') {
  appendFileSync(resolve(process.cwd(), 'public/pricing.js'), `\n// scripted edit ${Date.now()}\n`);
  console.log('Appended a comment to public/pricing.js.');
  process.exit(0);
}
console.log('Made no change.');
process.exit(action === 'fail' ? 1 : 0);
