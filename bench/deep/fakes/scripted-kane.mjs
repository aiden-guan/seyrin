#!/usr/bin/env node
// Fault injection for bench/deep/gate.mjs: a stand-in for `kane-cli run --agent` that plays back a
// scripted outcome per call instead of opening a browser. This is NOT Kane. It exists to test what
// Seyrin does with each kind of Kane result, including the bad ones real Kane rarely produces.
//   SCRIPTED_KANE_PLAN  JSON file: an array of outcome names, consumed one per run
//   SCRIPTED_KANE_LOG   NDJSON file: each call's objective and the outcome it got
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const planFile = process.env.SCRIPTED_KANE_PLAN;
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const outcome = plan.shift() ?? 'unscripted';
writeFileSync(planFile, JSON.stringify(plan));
appendFileSync(process.env.SCRIPTED_KANE_LOG, JSON.stringify({ objective: args[1], name: flag('--name') ?? null, bugDetection: flag('--bug-detection') ?? null, outcome }) + '\n');

const out = (o) => process.stdout.write(JSON.stringify({ ...o, v: 1, ts: new Date().toISOString() }) + '\n');
const end = (o) => out({ type: 'run_end', duration: 1, credits_consumed: 0, final_state: {}, ...o });
const start = () => out({ type: 'stream_start', surface: 'run', cli_version: 'scripted', pid: process.pid });
const step = (status) => out({ step: 1, status, remark: 'assert: scripted' });
const saveTest = () => {
  const name = flag('--name');
  if (!name) return;
  const dir = resolve(process.cwd(), '.testmuai/tests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${name}_test.md`), `---\nname: ${name}\n---\n`);
};

switch (outcome) {
  case 'pass': start(); step('done'); saveTest(); end({ status: 'passed', one_liner: 'Scripted pass: the check held.', result_code: 0 }); process.exit(0);
  case 'bug740': start(); step('failed'); end({ status: 'failed', one_liner: 'Scripted 740: confirmed product bug.', result_code: 740, verdict: { confirmed: true, severity: 'high' } }); process.exit(1);
  case 'fail': start(); step('failed'); end({ status: 'failed', one_liner: 'Scripted fail: the expected result did not happen.' }); process.exit(1);
  case 'timeout3': start(); end({ status: 'timeout', one_liner: 'Scripted timeout.' }); process.exit(3);
  case 'error2': process.stderr.write('scripted: bad arguments\n'); process.exit(2);
  case 'crash': start(); process.exit(1);
  case 'garbage': process.stdout.write('Segmentation fault (not JSON)\n'); process.exit(1);
  case 'silent0': start(); process.exit(0); // exit 0 but no run_end: a truncated or misbehaving run
  case 'endNoStatus0': start(); end({}); process.exit(0); // run_end with no status, exit 0
  case 'passedExit1': start(); end({ status: 'passed', one_liner: 'Scripted: run_end says passed but the process failed.' }); process.exit(1);
  default: process.stderr.write(`scripted: no outcome left in the plan\n`); process.exit(2);
}
