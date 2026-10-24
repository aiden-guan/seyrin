#!/usr/bin/env node
// Compile a markdown spec's acceptance criteria into saved Kane flows.
//
//   node gate/spec-to-flows.mjs specs/perch-core.md [--dry-run] [--headed] [--only a,b]
//
// Spec format: YAML-ish frontmatter (`app:`, `url:` base URL, `repo:` path relative to the
// pigeonbox-kane root) and a `## Acceptance criteria` section of bullets `- flow_name: objective`.
// Each criterion runs `kane-cli run "<objective>" --name <flow_name> --agent --headless --timeout 240`
// in <repo>, so Kane saves <repo>/.testmuai/tests/<flow_name>_test.md for the gate to replay.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, appendGateLog, frontmatter, newRunId, outcome, runKane, unreachableOrigins, userAgent } from './lib/kane.mjs';

const TIMEOUT_S = Number(process.env.KANE_SPEC_TIMEOUT || 240);

export function parseSpec(text) {
  const { data, body } = frontmatter(text);
  const criteria = [];
  const problems = [];
  let inSection = false;
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    if (/^#{1,2}\s/.test(line)) {
      inSection = /^##\s+acceptance criteria\b/i.test(line);
      current = null;
      continue;
    }
    if (!inSection) continue;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const m = /^`?([A-Za-z0-9_-]+)`?\s*:\s*(.+)$/.exec(bullet[1].trim());
      if (m) { current = { name: m[1], objective: m[2].trim() }; criteria.push(current); }
      else { current = null; problems.push(`ignored bullet without "flow_name: objective": ${bullet[1].trim()}`); }
      continue;
    }
    if (current && /^\s{2,}\S/.test(line)) current.objective += ' ' + line.trim();
    else if (!line.trim()) current = null;
  }
  return { meta: data, criteria, problems };
}

/** Rewrite the first relative path (e.g. /pricing) to an absolute URL and make sure it starts with "Go to". */
export function compileObjective(objective, baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  let out = objective.trim();
  // A path like /pricing (not part of a URL or "and/or"), or a bare "/" right after "go to", "open", "on"...
  const PATH = /(^|[\s("'`])(\/[A-Za-z0-9_-][A-Za-z0-9._~\-/%]*(?:\?[^\s"'`),]*)?)|(\b(?:go to|open|visit|navigate to|on|at)\s+)\/(?=$|[\s,;:!?)"'`])/i;
  out = out.replace(PATH, (_all, pre, path, verb) => {
    if (verb !== undefined) return `${verb}${base}/`;
    const trailing = /[.]+$/.exec(path)?.[0] || '';
    return pre + base + path.slice(0, path.length - trailing.length) + trailing;
  });
  if (!/^go to\b/i.test(out)) {
    const first = /^[A-Z][a-z]/.test(out) ? out[0].toLowerCase() + out.slice(1) : out;
    out = `Go to ${base}, then ${first}`;
  }
  const start = /https?:\/\/[^\s"'`),]+/.exec(out)?.[0].replace(/[.;:]+$/, '') || base;
  return { objective: out, startUrl: start };
}

const shellQuote = (s) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(String(argv[onlyIdx + 1] || '').split(',').filter(Boolean)) : null;
  const specArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--only');
  if (!specArg || has('--help')) {
    console.error('usage: node gate/spec-to-flows.mjs specs/<file>.md [--dry-run] [--headed] [--only name1,name2]');
    return 2;
  }
  const specPath = resolve(specArg);
  if (!existsSync(specPath)) { console.error(`spec not found: ${specArg}`); return 2; }
  const { meta, criteria: all, problems } = parseSpec(readFileSync(specPath, 'utf8'));
  for (const p of problems) console.error(`warning: ${p}`);
  if (!meta.url) { console.error('spec frontmatter needs `url:` (the app base URL)'); return 2; }
  if (!meta.repo) { console.error('spec frontmatter needs `repo:` (path relative to the pigeonbox-kane root)'); return 2; }
  const criteria = only ? all.filter((c) => only.has(c.name)) : all;
  if (!criteria.length) { console.error('no acceptance criteria found (expected "## Acceptance criteria" with "- flow_name: objective" bullets)'); return 2; }

  const repo = resolve(ROOT, meta.repo);
  const headed = has('--headed');
  const specName = basename(specPath).replace(/\.md$/, '');
  const compiled = criteria.map((c) => ({ ...c, source: c.objective, ...compileObjective(c.objective, meta.url) }));
  const argsFor = (c) => ['run', c.objective, '--name', c.name, '--agent', ...(headed ? [] : ['--headless']), '--timeout', String(TIMEOUT_S), '--url', c.startUrl];

  if (has('--dry-run')) {
    console.log(`spec ${specName} · app ${meta.app || '?'} · ${meta.url} · repo ${meta.repo} · ${criteria.length} criteria\n`);
    for (const c of compiled) {
      console.log(`${c.name}\n  objective: ${c.objective}\n  command:   (cd ${relative(process.cwd(), repo) || '.'} && kane-cli ${argsFor(c).map(shellQuote).join(' ')})\n`);
    }
    return 0;
  }

  if (!existsSync(repo)) { console.error(`repo not found: ${meta.repo} (resolved to ${repo})`); return 2; }
  const down = await unreachableOrigins(compiled.map((c) => c.startUrl));
  if (down.length) { console.error(`${down.join(', ')} is not reachable; start the app first (or set KANE_GATE_NO_PREFLIGHT=1).`); return 2; }

  const run = newRunId('spec');
  appendGateLog({ kind: 'gate_start', run, mode: 'spec', spec: specName, repo: relative(ROOT, repo), flows: compiled.map((c) => c.name) });
  console.error(`Spec ${specName} → ${relative(ROOT, repo)} · ${criteria.length} criteria${headed ? ' (headed)' : ''}`);
  const results = [];
  for (const c of compiled) {
    console.error(`\n▸ ${c.name}\n  ${c.objective}`);
    appendGateLog({ kind: 'flow_start', run, mode: 'spec', flow: c.name, objective: c.objective });
    const r = await runKane(argsFor(c), {
      cwd: repo,
      env: { KANE_CLI_USER_AGENT: userAgent() },
      timeoutMs: (TIMEOUT_S + 60) * 1000,
      onEvent: (event) => {
        appendGateLog({ kind: 'kane', run, mode: 'spec', flow: c.name, event });
        if (event.type === undefined && event.step !== undefined && event.status && event.status !== 'running') console.error(`    · step ${event.step} ${event.status}: ${event.remark ?? ''}`);
      },
    });
    const o = outcome(r);
    const testFile = join(repo, '.testmuai', 'tests', `${c.name}_test.md`);
    const saved = existsSync(testFile);
    const met = o.status === 'passed';
    results.push({ name: c.name, objective: c.objective, status: met ? 'met' : 'not_met', kane_status: o.status, reason: o.reason, remarks: o.remarks, test_file: saved ? relative(ROOT, testFile) : null, exit_code: r.exitCode, duration_ms: r.durationMs });
    appendGateLog({ kind: 'flow_end', run, mode: 'spec', flow: c.name, status: o.status, reason: o.reason, remarks: o.remarks, exit_code: r.exitCode, duration_ms: r.durationMs, test_file: saved ? relative(ROOT, testFile) : null });
    if (met) console.error(`  ✓ met${saved ? ` → ${relative(process.cwd(), testFile)}` : ' (warning: Kane did not save a _test.md)'}`);
    else {
      console.error(`  ✗ spec not met (${o.status}): ${o.reason}`);
      for (const m of o.remarks.slice(0, 6)) console.error(`      ${m}`);
    }
  }
  const metCount = results.filter((r) => r.status === 'met').length;
  appendGateLog({ kind: 'gate_end', run, mode: 'spec', spec: specName, repo: relative(ROOT, repo), passed: metCount, failed: results.length - metCount, decision: metCount === results.length ? 'spec_met' : 'spec_not_met' });
  console.error(`\n${metCount === results.length ? '✓' : '✗'} ${metCount} of ${results.length} criteria met`);
  console.log(JSON.stringify({ spec: relative(ROOT, specPath), repo: relative(ROOT, repo), met: metCount, not_met: results.length - metCount, criteria: results }));
  return metCount === results.length ? 0 : 1;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`spec-to-flows: ${err?.stack || err}`);
    process.exitCode = 1;
  });
}
