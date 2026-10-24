#!/usr/bin/env node
// Offline stand-in for `kane-cli` with the same NDJSON shape (agent mode, v1).
// Use with KANE_CLI_BIN=scripts/fake-kane-cli.mjs. It fails a run whose page still has a planted
// Perch bug and passes otherwise, so the bridge and gate can be exercised without credits.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const perch = resolve(here, '../demo-app/public');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const command = args[0];
const sub = args[1];
const ts = () => new Date().toISOString();
const emit = (obj) => process.stdout.write(JSON.stringify({ ...obj, v: 1, ts: ts() }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delay = Number(process.env.FAKE_KANE_STEP_MS || 350);

function bugFor(text) {
  const pricing = readFileSync(resolve(perch, 'pricing.js'), 'utf8');
  const signup = readFileSync(resolve(perch, 'signup.js'), 'utf8');
  if (/upgrade|checkout|choose team/i.test(text) && pricing.includes('dataset.planId')) return 'Clicking "Upgrade to Pro" did not open the checkout form; the page did not change.';
  if (/[^\s"']\+[^\s"']*@/.test(text) && signup.includes('[a-z0-9._-]+@')) return 'The form showed "Please enter a valid email address." for an address containing "+".';
  const shows = /verify the (\w+) plan shows (\$\d+)/i.exec(text);
  if (shows) {
    const html = readFileSync(resolve(perch, 'pricing.html'), 'utf8');
    const card = new RegExp(`<h2>${shows[1]}</h2><div class="price">\\${shows[2].slice(1)}\\b`, 'i');
    if (!card.test(html)) return `The ${shows[1]} plan does not show ${shows[2]}.`;
  }
  return null;
}

async function run(objective, surface) {
  const sessionDir = resolve(process.env.HOME, '.testmuai/kaneai/sessions/fake-' + Date.now());
  emit({ type: 'stream_start', surface, cli_version: '0.0.0-fake', pid: process.pid, session_dir: sessionDir });
  const clauses = objective.split(/,\s*then\s+/i);
  const bug = bugFor(objective);
  let step = 1;
  for (const clause of clauses) {
    emit({ step, status: 'running', remark: `Step ${step}` });
    await sleep(delay);
    const last = step === clauses.length;
    if (last && bug) {
      emit({ step, status: 'failed', remark: `assert: ${clause}` });
      return { status: 'failed', reason: bug, sessionDir, steps: step };
    }
    emit({ step, status: 'done', remark: `${step === 1 ? 'navigate' : last ? 'assert' : 'act'}: ${clause}` });
    step += 1;
  }
  return { status: 'passed', reason: 'All steps completed and the final check held.', sessionDir, steps: step - 1 };
}

if (command === '--version' || command === '-V') { console.log('0.0.0-fake'); process.exit(0); }
if (command === 'whoami') { console.log('fake profile (offline)'); process.exit(0); }

if (command === 'run') {
  const objective = args.find((a, i) => i > 0 && !a.startsWith('--') && !args[i - 1]?.startsWith('--')) || '';
  const started = Date.now();
  const result = await run(objective, 'run');
  const name = flag('--name');
  if (name && result.status === 'passed') {
    const dir = resolve(process.cwd(), '.testmuai/tests');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${name}_test.md`), `---\nname: ${name}\nobjective: ${JSON.stringify(objective)}\n---\n\n## ${objective}\n`);
  }
  emit({ type: 'run_end', status: result.status, summary: result.reason, one_liner: result.reason, reason: result.reason, duration: (Date.now() - started) / 1000, credits_consumed: 0, final_state: {}, session_dir: result.sessionDir, result_code: result.status === 'passed' ? 0 : 1 });
  process.exit(result.status === 'passed' ? 0 : 1);
}

if (command === 'testmd' && sub === 'run') {
  const file = args[2];
  if (!file || !existsSync(file)) { emit({ type: 'error', message: `No such test: ${file}` }); process.exit(2); }
  const text = readFileSync(file, 'utf8');
  const objective = (/objective:\s*(".*")/.exec(text)?.[1] && JSON.parse(/objective:\s*(".*")/.exec(text)[1])) || basename(file);
  const result = await run(objective, 'testmd');
  emit({ type: 'test_md_done', status: result.status, passed: result.status === 'passed', reason: result.reason, file });
  process.exit(result.status === 'passed' ? 0 : 1);
}

console.error(`fake-kane-cli: unsupported command ${args.join(' ')}`);
process.exit(2);
