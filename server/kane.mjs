// Kane CLI runs: one browser at a time, NDJSON parsed live, a screenshot pulled from the evidence pack.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { DATA_DIR, ROOT, kaneCommand } from './config.mjs';

export const SHOTS = resolve(DATA_DIR, 'shots');
export const EVIDENCE = resolve(ROOT, 'evidence');

const RUN_END_FIELDS = ['status', 'summary', 'one_liner', 'reason', 'reason_code', 'duration', 'credits_consumed', 'final_state', 'test_url', 'session_dir', 'result_code', 'verdict'];

export function createKaneRunner({ config }) {
  mkdirSync(SHOTS, { recursive: true });
  let queue = Promise.resolve();

  /**
   * @param {{objective: string, url: string, name?: string, cwd?: string, label: string, attempt: number, keepEvidence?: string}} job
   * @param {{onStart?: (run) => void, onLine?: (line) => void, onStep?: (run) => void}} hooks
   */
  function run(job, hooks = {}) {
    const next = queue.then(() => runNow(job, hooks));
    queue = next.catch(() => {});
    return next;
  }

  function runNow(job, hooks) {
    return new Promise((done) => {
      const args = ['run', job.objective, '--agent', '--url', job.url, '--max-steps', String(config.server.maxSteps), '--timeout', String(config.server.runTimeoutSeconds)];
      if (!config.server.headed) args.push('--headless');
      if (job.name) args.push('--name', job.name);
      const [cmd, argv] = kaneCommand(args);
      const run = { label: job.label, attempt: job.attempt, objective: job.objective, startedAt: new Date().toISOString(), endedAt: null, steps: [], exitCode: null, runEnd: null, sessionDir: null, screenshot: null, evidencePack: null, stderr: '' };
      hooks.onStart?.(run);
      let child;
      try {
        child = spawn(cmd, argv, { cwd: job.cwd || ROOT, env: { ...process.env, KANE_CLI_USER_AGENT: process.env.KANE_CLI_USER_AGENT || 'seyrin' }, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        Object.assign(run, { exitCode: 2, stderr: String(error.message), endedAt: new Date().toISOString() });
        return done(run);
      }
      createInterface({ input: child.stdout }).on('line', (raw) => {
        let line;
        try {
          line = JSON.parse(raw);
        } catch {
          return;
        }
        hooks.onLine?.(line);
        if (line.type === 'stream_start' && line.session_dir) run.sessionDir = line.session_dir;
        if (line.type === 'run_end') {
          run.runEnd = Object.fromEntries(RUN_END_FIELDS.filter((k) => line[k] !== undefined).map((k) => [k, line[k]]));
          if (line.session_dir) run.sessionDir = line.session_dir;
        }
        if (!line.type && typeof line.step === 'number') {
          const existing = run.steps.find((s) => s.step === line.step);
          if (existing) Object.assign(existing, { status: line.status, remark: line.remark || existing.remark });
          else run.steps.push({ step: line.step, status: line.status, remark: line.remark || '' });
          hooks.onStep?.(run);
        }
      });
      child.stderr.on('data', (chunk) => {
        run.stderr = (run.stderr + chunk).slice(-4000);
      });
      child.on('error', (error) => {
        run.stderr += `\n${error.message}`;
      });
      child.on('close', (code) => {
        run.exitCode = code ?? 1;
        run.endedAt = new Date().toISOString();
        try {
          collectEvidence(run, job.keepEvidence);
        } catch {}
        done(run);
      });
    });
  }

  return { run };
}

/** Pull the last screenshot out of the sealed evidence pack, and keep a copy of the pack in the repo when asked. */
function collectEvidence(run, keepAs) {
  const dir = run.sessionDir && resolve(run.sessionDir, 'evidence');
  if (!dir || !existsSync(dir)) return;
  const pack = readdirSync(dir).filter((f) => f.endsWith('.evidence')).map((f) => resolve(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!pack) return;
  run.evidencePack = pack;
  if (keepAs) {
    mkdirSync(EVIDENCE, { recursive: true });
    const copy = resolve(EVIDENCE, `${keepAs}.evidence`);
    writeFileSync(copy, execFileSync('cat', [pack], { maxBuffer: 256 * 1024 * 1024 }));
    run.evidenceCopy = basename(copy);
  }
  const entries = execFileSync('unzip', ['-Z1', pack], { encoding: 'utf8' }).split('\n').filter((e) => /\/screenshot\.(png|jpe?g|webp)$/i.test(e) || /\.(png|jpe?g|webp)$/i.test(e));
  if (!entries.length) return;
  const last = entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).filter((e) => /screenshot/i.test(e)).at(-1) || entries.at(-1);
  const out = resolve(SHOTS, `${basename(pack, '.evidence')}${last.slice(last.lastIndexOf('.'))}`);
  writeFileSync(out, execFileSync('unzip', ['-p', pack, last], { maxBuffer: 64 * 1024 * 1024 }));
  run.screenshot = basename(out);
}
