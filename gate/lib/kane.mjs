// Shared Kane CLI helpers for the gate and the spec compiler: spawn Kane in agent mode, parse its
// NDJSON stream line by line, and append gate events to .data/gate.ndjson for the live panel.
// Plain Node ESM, no dependencies.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** the Seyrin repo (the folder that holds gate/, demo-app/, specs/). */
export const ROOT = resolve(here, '../..');
export const GATE_LOG = process.env.KANE_GATE_LOG ? resolve(process.env.KANE_GATE_LOG) : resolve(ROOT, '.data/gate.ndjson');

/** Which binary to run: env KANE_CLI_BIN (default `kane-cli`); a .mjs/.cjs/.js path runs under this Node. */
export function kaneCommand(args) {
  const raw = process.env.KANE_CLI_BIN || 'kane-cli';
  const bin = /[\\/]/.test(raw) ? resolve(raw) : raw;
  if (/\.(mjs|cjs|js)$/i.test(bin)) return { cmd: process.execPath, argv: [bin, ...args], bin };
  return { cmd: bin, argv: args, bin };
}

/** Append one event to .data/gate.ndjson: {ts, source:'gate', kind, ...}. Never throws. */
export function appendGateLog(event) {
  try {
    mkdirSync(dirname(GATE_LOG), { recursive: true });
    appendFileSync(GATE_LOG, JSON.stringify({ ts: new Date().toISOString(), source: 'gate', ...event }) + '\n');
  } catch {}
}

export function newRunId(prefix = 'g') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const tail = (text, max = 4000) => (text.length > max ? text.slice(-max) : text);

/**
 * Spawn Kane with `args`, parse stdout as NDJSON and call onEvent(obj) for every parsed JSON object.
 * Non-JSON lines and unknown fields/types are ignored (kept only in stdoutTail).
 * Resolves (never rejects) with:
 *   { exitCode, runEnd, lastTyped, done, steps:[{step,status,remark}], failedSteps, failedHeadings,
 *     bugs, stderrTail, stdoutTail, timedOut, canceled, durationMs }
 * exitCode follows Kane: 0 passed, 1 failed, 2 did not start, 3 canceled/timeout.
 */
export function runKane(args, { cwd = process.cwd(), env = {}, onEvent, timeoutMs, signal } = {}) {
  const { cmd, argv } = kaneCommand(args);
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const steps = new Map();
    const headings = new Map();
    const failedHeadings = [];
    const bugs = [];
    let runEnd = null;
    let lastTyped = null;
    let done = null;
    let stdoutTail = '';
    let stderrTail = '';
    let buffer = '';
    let settled = false;
    let timedOut = false;
    let canceled = false;
    let timer = null;
    let child = null;

    const finish = (exitCode, note) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (buffer) handleLine(buffer);
      buffer = '';
      if (note) stderrTail = tail(stderrTail + note + '\n');
      const list = [...steps.values()];
      resolvePromise({
        exitCode,
        runEnd,
        lastTyped,
        done,
        steps: list,
        failedSteps: list.filter((s) => s.status === 'failed'),
        failedHeadings,
        bugs,
        stderrTail,
        stdoutTail,
        timedOut,
        canceled,
        durationMs: Date.now() - started,
      });
    };

    function handleLine(line) {
      const text = line.trim();
      if (!text) return;
      let obj = null;
      if (text.startsWith('{')) {
        try { obj = JSON.parse(text); } catch {}
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        stdoutTail = tail(stdoutTail + text + '\n', 2000);
        return;
      }
      if (typeof obj.type === 'string') {
        lastTyped = obj;
        if (obj.type === 'run_end') runEnd = obj;
        if (obj.type === 'run_end' || obj.type === 'test_md_done' || obj.type === 'testrun_done') done = obj;
        if (obj.type === 'test_md_step_start') headings.set(obj.step_index, obj.heading);
        if (obj.type === 'test_md_step_end' && obj.status && obj.status !== 'passed' && obj.status !== 'skipped') {
          failedHeadings.push({ step_index: obj.step_index, heading: headings.get(obj.step_index) || null });
        }
        if (obj.type === 'test_md_bug_verdict' && obj.confirmed) bugs.push({ title: obj.bug_title || null, one_liner: obj.one_liner || null });
      } else if (obj.step !== undefined && obj.status !== undefined) {
        const key = `${obj.child_id ?? ''}:${obj.step}`;
        const prev = steps.get(key);
        const remark = typeof obj.remark === 'string' && obj.remark.trim() ? obj.remark : prev?.remark ?? '';
        steps.set(key, { step: obj.step, status: obj.status, remark, ...(obj.child_id ? { child_id: obj.child_id } : {}) });
      }
      try { onEvent?.(obj); } catch {}
    }

    try {
      child = spawn(cmd, argv, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish(2, `could not start ${cmd}: ${err.message}`);
      return;
    }

    const kill = (sig) => { try { child.kill(sig); } catch {} };
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        kill('SIGTERM');
        setTimeout(() => kill('SIGKILL'), 5000).unref();
      }, timeoutMs);
    }
    if (signal) {
      if (signal.aborted) { canceled = true; kill('SIGTERM'); }
      else signal.addEventListener('abort', () => { canceled = true; kill('SIGTERM'); }, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderrTail = tail(stderrTail + chunk); });
    child.on('error', (err) => finish(2, `could not start ${cmd}: ${err.message}`));
    child.on('close', (code) => finish(timedOut || canceled ? 3 : code ?? 3));
  });
}

const REASON_KEYS = ['one_liner', 'summary', 'reason', 'message', 'error'];
function pickReason(obj) {
  if (!obj) return '';
  for (const key of REASON_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof v.message === 'string' && v.message.trim()) return v.message.trim();
  }
  return '';
}
const firstLine = (text) => (text || '').split('\n')[0].trim();
const lastLine = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) || '';
/** The last "error:" line of stderr plus what follows it (Kane prints hints as bullets), one line. */
function stderrReason(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let i = lines.findLastIndex((l) => /^error\b|\berror:/i.test(l));
  if (i < 0) i = lines.length - 1;
  const joined = lines.slice(i).join(' ').replace(/^error:\s*/i, '');
  return joined.length > 400 ? joined.slice(0, 400) + '…' : joined;
}

/**
 * Turn a runKane result into {status, reason, remarks}. The exit code is the source of truth:
 * 0 passed, 1 failed, 3 timeout (counts as a failure), anything else 'error' (Kane did not start).
 */
export function outcome(r) {
  const status = r.exitCode === 0 ? 'passed' : r.exitCode === 1 ? 'failed' : r.exitCode === 3 ? 'timeout' : 'error';
  const remarks = [];
  for (const s of r.failedSteps) if (s.remark) remarks.push(`step ${s.step}: ${s.remark}`);
  for (const h of r.failedHeadings) if (h.heading && !/^Step \d+$/i.test(h.heading)) remarks.push(`step ${h.step_index ?? '?'}: "${h.heading}"`);
  const bug = r.bugs.at(-1);
  const bugText = bug ? [bug.title, bug.one_liner].filter(Boolean).join(': ') : '';
  // A confirmed bug verdict and the one-liner describe the app; `reason` often describes Kane ("agent is stuck").
  let reason = bugText || firstLine(pickReason(r.runEnd)) || firstLine(pickReason(r.lastTyped)) || r.failedSteps.at(-1)?.remark || '';
  if (status === 'passed') return { status, reason: reason || 'passed', remarks: [] };
  if (status === 'timeout') {
    const why = r.timedOut ? 'Kane did not finish in time' : 'Kane run was canceled or timed out (exit 3)';
    return { status, reason: reason ? `${why}: ${reason}` : why, remarks };
  }
  if (status === 'error') {
    reason = reason || stderrReason(r.stderrTail) || lastLine(r.stdoutTail) || `exit ${r.exitCode}`;
    return { status, reason: `Kane did not start (exit ${r.exitCode}): ${reason}`, remarks };
  }
  return { status, reason: reason || stderrReason(r.stderrTail) || 'Kane reported a failure without a reason', remarks };
}

/** Frontmatter `key: value` pairs of a markdown file (YAML-ish, one level, quotes stripped). */
export function frontmatter(text) {
  const out = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return { data: out, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    let value = kv[2];
    if (/^".*"$/.test(value)) { try { value = JSON.parse(value); } catch { value = value.slice(1, -1); } }
    else if (/^'.*'$/.test(value)) value = value.slice(1, -1);
    out[kv[1]] = value;
  }
  return { data: out, body: text.slice(m[0].length) };
}

/** Start URL and a one-line description of a saved *_test.md flow (best effort; format may vary). */
export function flowMeta(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return { url: null, objective: null }; }
  const { data, body } = frontmatter(text);
  const urlMatch = /https?:\/\/[^\s"'<>)\]`,]+/.exec(typeof data.url === 'string' && data.url ? data.url : text);
  // Kane writes "## Step N" headings with the step text on the following lines.
  const headings = [...body.matchAll(/^##\s+(.+)\n+([^#\n][^\n]*)?/gm)].map((m) => (/^Step \d+$/i.test(m[1].trim()) && m[2] ? m[2] : m[1]).trim());
  const objective = (typeof data.objective === 'string' && data.objective) || headings.join(' → ') || null;
  return { url: urlMatch ? urlMatch[0].replace(/[.;:]+$/, '') : null, objective };
}

/** Origins (of the given URLs) that do not answer HTTP within 4s. Skipped when KANE_GATE_NO_PREFLIGHT=1. */
export async function unreachableOrigins(urls) {
  if (process.env.KANE_GATE_NO_PREFLIGHT === '1') return [];
  const origins = new Set();
  for (const u of urls) { try { if (u) origins.add(new URL(u).origin); } catch {} }
  const down = [];
  await Promise.all([...origins].map(async (origin) => {
    try { await fetch(origin, { signal: AbortSignal.timeout(4000), redirect: 'manual' }); } catch { down.push(origin); }
  }));
  return down;
}

/** Value for KANE_CLI_USER_AGENT: an explicit env wins, then the given agent name. */
export function userAgent(fallback) {
  return process.env.KANE_CLI_USER_AGENT || fallback || (process.env.GITHUB_ACTIONS ? 'github-actions' : 'claude-code');
}
