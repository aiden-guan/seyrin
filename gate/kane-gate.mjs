#!/usr/bin/env node
// Kane gate: replay a repo's saved Kane flows (<repo>/.testmuai/tests/*_test.md) with
// `kane-cli testmd run <file> --agent --headless` and use the result to gate a coding agent.
//
//   node gate/kane-gate.mjs --hook                      Claude Code Stop hook (reads hook JSON on stdin)
//   node gate/kane-gate.mjs [--check] [dir] [--headed]  replay once, summary on stderr, JSON on stdout (CI)
//   node gate/kane-gate.mjs --watch [dir] [--now]       replay on every save, one line per flow
//   node gate/kane-gate.mjs --loop --agent "<cmd {prompt}>" [dir] [--rounds 3]
//                                                       fix loop for agents without hooks
//
// Env: KANE_CLI_BIN (default kane-cli), KANE_GATE_SKIP=1 (hook does nothing), KANE_GATE_HEADED=1,
// KANE_GATE_FLOW_TIMEOUT (s, default 240), KANE_GATE_BUDGET_S (hook total, default 540),
// KANE_GATE_CONCURRENCY (default 1), KANE_GATE_TESTMD_ARGS (extra args for testmd run),
// KANE_GATE_NO_PREFLIGHT=1 (skip the "is the app up" check).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { ROOT, appendGateLog, flowMeta, newRunId, outcome, runKane, unreachableOrigins, userAgent } from './lib/kane.mjs';

const MAX_ATTEMPTS = 3;
const FLOW_TIMEOUT_S = Number(process.env.KANE_GATE_FLOW_TIMEOUT || 240);
const HOOK_BUDGET_S = Number(process.env.KANE_GATE_BUDGET_S || 540);
const CONCURRENCY = Math.max(1, Number(process.env.KANE_GATE_CONCURRENCY || 1));
const EXTRA_ARGS = (process.env.KANE_GATE_TESTMD_ARGS || '').split(/\s+/).filter(Boolean);
const IGNORED = new Set(['.git', '.testmuai', 'node_modules', '.data']);
const STATE_FILE = (repo) => join(repo, '.testmuai', 'kane-gate.json');

// ---------- flows ----------

function listFlows(repo) {
  const dir = join(repo, '.testmuai', 'tests');
  try {
    return readdirSync(dir).filter((f) => f.endsWith('_test.md')).sort().map((f) => join(dir, f));
  } catch {
    return [];
  }
}
const flowName = (file) => basename(file).replace(/_test\.md$/, '');
const rel = (from, to) => relative(from, to) || '.';
/** Repo label for output/logs: relative to the pigeonbox-kane root when inside it, else absolute. */
const show = (repo) => { const r = relative(ROOT, repo); return !r ? '.' : r.startsWith('..') ? repo : r; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** Replay every flow in repo. Logs gate_start, flow_start, kane, flow_end (caller logs gate_end). */
async function runGate(repo, { mode, headed = false, agent, budgetS, onFlowStart, onFlowEnd, onKane, extra = {} } = {}) {
  const run = newRunId(mode);
  const files = listFlows(repo);
  const flows = files.map(flowName);
  const repoRel = show(repo);
  appendGateLog({ kind: 'gate_start', run, mode, repo: repoRel, flows, ...extra });
  const deadline = budgetS ? Date.now() + budgetS * 1000 : Infinity;
  const results = new Array(files.length);
  let next = 0;

  async function worker() {
    while (next < files.length) {
      const i = next++;
      const file = files[i];
      const flow = flows[i];
      const fileRel = rel(repo, file);
      const remainingS = Math.floor((deadline - Date.now()) / 1000);
      if (remainingS < 30) {
        results[i] = { flow, file: fileRel, status: 'skipped', reason: 'gate time budget used up', remarks: [], exitCode: null, durationMs: 0 };
        appendGateLog({ kind: 'flow_end', run, mode, flow, status: 'skipped', reason: results[i].reason });
        onFlowEnd?.(results[i]);
        continue;
      }
      const timeoutS = Math.max(30, Math.min(FLOW_TIMEOUT_S, remainingS - 10));
      const args = ['testmd', 'run', fileRel, '--agent', ...(headed ? [] : ['--headless']), '--timeout', String(timeoutS), ...EXTRA_ARGS];
      appendGateLog({ kind: 'flow_start', run, mode, flow, file: fileRel });
      onFlowStart?.(flow, fileRel);
      const r = await runKane(args, {
        cwd: repo,
        env: { KANE_CLI_USER_AGENT: userAgent(agent) },
        timeoutMs: (timeoutS + 30) * 1000,
        onEvent: (event) => {
          appendGateLog({ kind: 'kane', run, mode, flow, event });
          onKane?.(flow, event);
        },
      });
      const o = outcome(r);
      results[i] = { flow, file: fileRel, ...o, exitCode: r.exitCode, durationMs: r.durationMs };
      appendGateLog({ kind: 'flow_end', run, mode, flow, status: o.status, reason: o.reason, remarks: o.remarks, exit_code: r.exitCode, duration_ms: r.durationMs });
      onFlowEnd?.(results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  const count = (...s) => results.filter((r) => s.includes(r.status)).length;
  return { run, mode, repo, results, total: results.length, passed: count('passed'), failed: count('failed', 'timeout'), errors: count('error'), skipped: count('skipped') };
}

function endGate(g, decision, extra = {}) {
  appendGateLog({ kind: 'gate_end', run: g.run, mode: g.mode, repo: show(g.repo), passed: g.passed, failed: g.failed, errors: g.errors, skipped: g.skipped, decision, ...extra });
}

/** The fix-it prompt handed to the agent (hook block reason / loop prompt). */
function feedbackPrompt(g, { attempt, max, then }) {
  const bad = g.results.filter((r) => r.status === 'failed' || r.status === 'timeout');
  const lines = [`Kane gate: ${bad.length} of ${plural(g.total, 'browser flow')} failed${attempt ? ` (fix attempt ${attempt} of ${max})` : ''}.`, ''];
  for (const r of bad) {
    const meta = flowMeta(join(g.repo, r.file));
    lines.push(`FAILED ${r.flow} (${r.file})`);
    if (meta.objective) lines.push(`  Flow: ${meta.objective.length > 400 ? meta.objective.slice(0, 400) + '…' : meta.objective}`);
    lines.push(`  Kane: ${r.reason}`);
    for (const m of r.remarks.filter((m) => !m.endsWith(r.reason)).slice(0, 6)) lines.push(`  Failed ${m}`);
  }
  const errs = g.results.filter((r) => r.status === 'error' || r.status === 'skipped');
  for (const r of errs) lines.push(`NOT RUN ${r.flow}: ${r.reason}`);
  const ok = g.results.filter((r) => r.status === 'passed').map((r) => r.flow);
  if (ok.length) lines.push('', `Still passing: ${ok.join(', ')}.`);
  lines.push(
    '',
    'Fix the application code so these flows pass. Do not edit, delete, rename or skip the tests, and do not touch anything in .testmuai/ — the flows are the spec. Make the behaviour the flow describes actually work.',
    then,
  );
  const text = lines.join('\n');
  return text.length > 6000 ? text.slice(0, 6000) + '\n…' : text;
}

// ---------- change detection (skip the hook when nothing changed since the last green gate) ----------

function changeHash(repo, flows) {
  const h = createHash('sha256');
  const git = (args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const scope = ['--', '.', ':(exclude).testmuai'];
  let isGit = false;
  try { isGit = git(['rev-parse', '--is-inside-work-tree']).toString().trim() === 'true'; } catch {}
  if (isGit) {
    try {
      h.update(git(['diff', 'HEAD', '--no-ext-diff', '--binary', ...scope]));
    } catch {
      // No commits yet: worktree vs index plus index vs empty tree.
      h.update('no-head');
      try { h.update(git(['diff', '--no-ext-diff', '--binary', ...scope])); } catch {}
      try { h.update(git(['diff', '--cached', '--no-ext-diff', '--binary', ...scope])); } catch {}
    }
    try {
      const status = git(['status', '--porcelain', '--untracked-files=all', ...scope]).toString();
      h.update(status.split('\n').filter((l) => l && !l.includes('.testmuai/')).join('\n'));
    } catch {}
    // `git diff` does not see untracked files, so hash their contents too.
    try {
      const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', ...scope]).toString().split('\0').filter(Boolean);
      for (const f of untracked) { h.update(f); h.update(fileDigest(join(repo, f))); }
    } catch {}
  } else {
    walk(repo, (file, st) => { h.update(rel(repo, file)); h.update(`${st.size}:${st.mtimeMs}`); });
  }
  h.update('flows');
  for (const f of flows) { h.update(basename(f)); h.update(fileDigest(f)); }
  return h.digest('hex');
}

function fileDigest(file) {
  try {
    const st = statSync(file);
    if (!st.isFile()) return 'not-a-file';
    if (st.size > 5 * 1024 * 1024) return `${st.size}:${st.mtimeMs}`;
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return 'missing';
  }
}

function walk(dir, visit) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, visit);
    else if (e.isFile()) { try { visit(p, statSync(p)); } catch {} }
  }
}

function loadState(repo) {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE(repo), 'utf8'));
    return { attempts: {}, ...s, attempts: s.attempts && typeof s.attempts === 'object' ? s.attempts : {} };
  } catch {
    return { lastPassHash: null, attempts: {} };
  }
}
function saveState(repo, state) {
  mkdirSync(dirname(STATE_FILE(repo)), { recursive: true });
  writeFileSync(STATE_FILE(repo), JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n');
}

// ---------- --hook (Claude Code Stop hook) ----------

async function readStdin() {
  if (process.stdin.isTTY) return '';
  return new Promise((done) => {
    let data = '';
    const timer = setTimeout(() => done(data), 5000);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { clearTimeout(timer); done(data); });
    process.stdin.on('error', () => { clearTimeout(timer); done(data); });
  });
}

/** First dir from `start` upward (not above `stopAt`) that has .testmuai/tests; else `start`. */
function findRepo(start, stopAt) {
  const stop = stopAt ? resolve(stopAt) : null;
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, '.testmuai', 'tests'))) return dir;
    const up = dirname(dir);
    if (dir === stop || up === dir || (stop && !dir.startsWith(stop + sep))) return start;
    dir = up;
  }
}

const say = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

async function hookMode({ headed }) {
  if (process.env.KANE_GATE_SKIP === '1') return 0;
  let input = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) input = JSON.parse(raw);
  } catch {}
  const start = resolve(input.cwd || process.cwd());
  const repo = findRepo(start, process.env.CLAUDE_PROJECT_DIR);
  const flows = listFlows(repo);
  if (!flows.length) return 0;

  const session = String(input.session_id || 'default');
  const extra = { session_id: session, stop_hook_active: !!input.stop_hook_active };
  const state = loadState(repo);
  const before = changeHash(repo, flows);
  if (state.lastPassHash && state.lastPassHash === before) {
    appendGateLog({ kind: 'gate_end', run: newRunId('hook'), mode: 'hook', repo: show(repo), passed: 0, failed: 0, decision: 'skip', reason: 'nothing changed since the last green gate', ...extra });
    say({ systemMessage: `Kane gate: nothing changed since the last green run (${plural(flows.length, 'flow')}), skipped` });
    return 0;
  }

  const down = await unreachableOrigins(flows.map((f) => flowMeta(f).url));
  if (down.length) {
    appendGateLog({ kind: 'gate_end', run: newRunId('hook'), mode: 'hook', repo: show(repo), passed: 0, failed: 0, decision: 'error', reason: `not reachable: ${down.join(', ')}`, ...extra });
    say({ systemMessage: `Kane gate: not run, ${down.join(', ')} is not reachable (is the app running?)` });
    return 0;
  }

  const g = await runGate(repo, { mode: 'hook', headed, agent: 'claude-code', budgetS: HOOK_BUDGET_S, extra });

  if (g.passed === g.total) {
    state.lastPassHash = changeHash(repo, listFlows(repo));
    state.lastPassAt = new Date().toISOString();
    delete state.attempts[session];
    saveState(repo, state);
    endGate(g, 'allow', extra);
    say({ systemMessage: `Kane gate: ${plural(g.passed, 'flow')} passed` });
    return 0;
  }

  if (g.failed === 0) {
    // Only infrastructure problems (Kane not logged in, budget) — don't send Claude after app code.
    const why = g.results.find((r) => r.status !== 'passed')?.reason || 'unknown error';
    endGate(g, 'error', { ...extra, reason: why });
    say({ systemMessage: `Kane gate: could not check (${why}); not blocking` });
    return 0;
  }

  const attempts = (Number(state.attempts[session]) || 0) + 1;
  state.attempts[session] = attempts;
  saveState(repo, state);
  const failing = g.results.filter((r) => r.status === 'failed' || r.status === 'timeout').map((r) => r.flow);
  if (attempts <= MAX_ATTEMPTS) {
    const reason = feedbackPrompt(g, { attempt: attempts, max: MAX_ATTEMPTS, then: 'Then finish again: the Kane gate replays every flow when you stop.' });
    endGate(g, 'block', { ...extra, attempt: attempts, failing });
    say({ decision: 'block', reason, systemMessage: `Kane gate: ${failing.join(', ')} failing, sending Claude back to fix it (attempt ${attempts}/${MAX_ATTEMPTS})` });
    return 0;
  }
  endGate(g, 'escalate', { ...extra, attempt: attempts, failing, reason: 'needs a human' });
  say({ systemMessage: `Kane gate: still failing after ${MAX_ATTEMPTS} fix attempts, needs a human (failing: ${failing.join(', ')})` });
  return 0;
}

// ---------- --check (CI / manual) ----------

const icon = (s) => (s === 'passed' ? '✓' : s === 'skipped' ? '-' : s === 'error' ? '!' : '✗');

function printResult(r, { long = true } = {}) {
  const head = `  ${icon(r.status)} ${r.flow.padEnd(22)} ${secs(r.durationMs).padStart(6)}`;
  if (r.status === 'passed') return console.error(head);
  console.error(`${head}  ${r.status}: ${r.reason}`);
  if (long) for (const m of r.remarks.filter((m) => !m.endsWith(r.reason)).slice(0, 6)) console.error(`      ${m}`);
}

async function checkMode(dir, { headed }) {
  const repo = resolve(dir || process.cwd());
  const flows = listFlows(repo);
  if (!flows.length) {
    const msg = `Kane gate: no flows in ${rel(process.cwd(), join(repo, '.testmuai', 'tests'))} (nothing to check)`;
    console.error(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : msg);
    say({ ok: true, repo: show(repo), total: 0, passed: 0, failed: 0, errors: 0, flows: [] });
    return 0;
  }
  const down = await unreachableOrigins(flows.map((f) => flowMeta(f).url));
  if (down.length) {
    console.error(`Kane gate: ${down.join(', ')} is not reachable; start the app first.`);
    say({ ok: false, repo: show(repo), total: flows.length, passed: 0, failed: 0, errors: flows.length, error: `not reachable: ${down.join(', ')}`, flows: [] });
    return 1;
  }
  console.error(`Kane gate · ${show(repo)} · replaying ${plural(flows.length, 'flow')}${headed ? ' (headed)' : ''}`);
  const g = await runGate(repo, {
    mode: 'check',
    headed,
    onFlowStart: (flow) => console.error(`▸ ${flow}`),
    onKane: (flow, e) => {
      if (e.step !== undefined && e.status && e.status !== 'running' && e.type === undefined) console.error(`    · step ${e.step} ${e.status}: ${e.remark ?? ''}`);
    },
    onFlowEnd: (r) => printResult(r),
  });
  const ok = g.passed === g.total;
  endGate(g, ok ? 'pass' : 'fail');
  console.error(`${ok ? '✓' : '✗'} ${g.passed} passed, ${g.failed} failed${g.errors ? `, ${g.errors} could not run` : ''}${g.skipped ? `, ${g.skipped} skipped` : ''}`);
  say({ ok, repo: show(repo), total: g.total, passed: g.passed, failed: g.failed, errors: g.errors, flows: g.results.map(({ flow, file, status, reason, remarks, exitCode, durationMs }) => ({ flow, file, status, reason, remarks, exit_code: exitCode, duration_ms: durationMs })) });
  return ok ? 0 : 1;
}

// ---------- --watch ("Kane on every save") ----------

const clock = () => new Date().toTimeString().slice(0, 8);

async function watchMode(dir, { headed, now }) {
  const repo = resolve(dir || process.cwd());
  let running = false;
  let pending = false;
  let timer = null;
  const changed = new Set();

  async function go() {
    if (running) { pending = true; return; }
    running = true;
    const why = [...changed];
    changed.clear();
    try {
      const flows = listFlows(repo);
      const label = why.length ? `${why.slice(0, 3).join(', ')}${why.length > 3 ? ` +${why.length - 3}` : ''} changed` : 'manual run';
      if (!flows.length) {
        console.log(`[${clock()}] ${label}; no flows in .testmuai/tests yet`);
      } else {
        const down = await unreachableOrigins(flows.map((f) => flowMeta(f).url));
        if (down.length) {
          console.log(`[${clock()}] ${label}; ${down.join(', ')} is not reachable, not replaying`);
        } else {
          console.log(`[${clock()}] ${label} → replaying ${plural(flows.length, 'flow')}`);
          const g = await runGate(repo, {
            mode: 'watch',
            headed,
            extra: { changed: why.slice(0, 20) },
            onFlowEnd: (r) => console.log(`  ${icon(r.status)} ${r.flow.padEnd(22)} ${secs(r.durationMs).padStart(6)}${r.status === 'passed' ? '' : `  ${r.reason}`}`),
          });
          const ok = g.passed === g.total;
          endGate(g, ok ? 'pass' : 'fail');
          console.log(`[${clock()}] ${ok ? 'green' : 'RED'}: ${g.passed}/${g.total} passed`);
        }
      }
    } catch (err) {
      console.log(`[${clock()}] gate error: ${err.message}`);
    } finally {
      running = false;
      if (pending) { pending = false; setTimeout(go, 0); }
    }
  }
  const trigger = (why) => {
    if (why) changed.add(why);
    clearTimeout(timer);
    timer = setTimeout(go, 1500);
  };

  watch(repo, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const name = String(filename);
    if (name.split(/[\\/]/).some((part) => IGNORED.has(part))) return;
    if (/(~|\.swp|\.swx|\.tmp|\.DS_Store|\/4913|^4913)$/.test(name)) return;
    trigger(name);
  });
  console.log(`Kane gate watching ${show(repo)} · ${plural(listFlows(repo).length, 'flow')} · save a file to replay${process.stdin.isTTY ? ' (Enter replays now)' : ''}`);
  if (process.stdin.isTTY) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', () => go());
  }
  if (now) go();
  return new Promise(() => {});
}

// ---------- --loop (fix loop for agents without hooks) ----------

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function substitutePrompt(command, prompt) {
  const q = shellQuote(prompt);
  if (!command.includes('{prompt}')) return `${command} ${q}`;
  return command.replace(/(["']?)\{prompt\}\1/g, () => q);
}

function runShell(command, cwd) {
  return new Promise((done) => {
    const child = spawn(command, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, KANE_GATE_SKIP: '1' } });
    child.on('error', (err) => { console.error(`agent failed to start: ${err.message}`); done(127); });
    child.on('close', (code) => done(code ?? 1));
  });
}

async function loopMode(dir, { agentCmd, headed, rounds }) {
  if (!agentCmd) { console.error('--loop needs --agent "<command with {prompt}>"'); return 2; }
  const repo = resolve(dir || process.cwd());
  const agentName = basename(agentCmd.trim().split(/\s+/)[0] || 'agent');
  for (let round = 0; ; round++) {
    if (!listFlows(repo).length) { console.error('Kane gate: no flows to replay'); return 0; }
    console.error(`Kane gate loop · round ${round}/${rounds} · replaying flows in ${show(repo)}`);
    const g = await runGate(repo, { mode: 'loop', headed, agent: agentName, extra: { round, agent: agentName }, onFlowEnd: (r) => printResult(r, { long: false }) });
    if (g.passed === g.total) { endGate(g, 'pass', { round }); console.error(`✓ green${round ? ` after ${plural(round, 'fix round')}` : ''}`); return 0; }
    if (g.failed === 0) { endGate(g, 'error', { round }); console.error('Kane could not run the flows; not starting the agent.'); return 1; }
    if (round >= rounds) {
      endGate(g, 'escalate', { round, reason: 'needs a human' });
      console.error(`✗ still failing after ${plural(rounds, 'fix round')}, needs a human`);
      return 1;
    }
    endGate(g, 'fail', { round });
    const prompt = feedbackPrompt(g, { attempt: round + 1, max: rounds, then: 'When you are done, exit; the Kane gate replays every flow after you finish.' });
    console.error(`→ round ${round + 1}/${rounds}: handing ${g.failed} failing flow${g.failed === 1 ? '' : 's'} to ${agentName}`);
    appendGateLog({ kind: 'agent_start', run: g.run, mode: 'loop', round: round + 1, agent: agentName });
    const code = await runShell(substitutePrompt(agentCmd, prompt), repo);
    appendGateLog({ kind: 'agent_end', run: g.run, mode: 'loop', round: round + 1, agent: agentName, exit_code: code });
    if (code !== 0) console.error(`  (${agentName} exited ${code}; replaying anyway)`);
  }
}

// ---------- main ----------

const USAGE = `usage:
  kane-gate.mjs --hook                                  Claude Code Stop hook (stdin: hook JSON)
  kane-gate.mjs [--check] [dir] [--headed]              replay all flows once (exit 0 green, 1 red)
  kane-gate.mjs --watch [dir] [--headed] [--now]        replay on every save
  kane-gate.mjs --loop --agent "<cmd {prompt}>" [dir] [--rounds 3] [--headed]`;

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const valued = new Set(['--agent', '--rounds']);
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const headed = has('--headed') || process.env.KANE_GATE_HEADED === '1';
  if (has('--help') || has('-h')) { console.log(USAGE); return 0; }

  if (has('--hook')) {
    const bail = (err) => {
      appendGateLog({ kind: 'gate_error', mode: 'hook', error: String(err?.stack || err) });
      process.exit(0);
    };
    process.on('uncaughtException', bail);
    process.on('unhandledRejection', bail);
    try { return await hookMode({ headed }); } catch (err) { bail(err); return 0; }
  }
  if (has('--watch')) return watchMode(positional[0], { headed, now: has('--now') });
  if (has('--loop')) return loopMode(positional[0], { agentCmd: val('--agent'), headed, rounds: Math.max(1, Number(val('--rounds') || 3)) });
  return checkMode(positional[0], { headed });
}

main().then((code) => { if (typeof code === 'number') process.exitCode = code; }, (err) => {
  console.error(`kane-gate: ${err?.stack || err}`);
  process.exitCode = 1;
});
