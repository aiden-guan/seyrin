// Benchmark 3: the Kane gate under fault injection.
//
// Runs the real task state machine (server/tasks.mjs, unmodified) in a throwaway copy of the repo,
// with kane-cli replaced by fakes/scripted-kane.mjs and the coding agent by fakes/scripted-agent.mjs.
// It answers one question: given each kind of Kane result, does Seyrin only say "done" after a
// passing Kane run, stop after 3 rounds, feed Kane's failure back to the agent, and undo cleanly?
// It says nothing about how well Kane itself finds bugs: no browser is opened.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SKIP = new Set(['node_modules', '.git', '.data', 'evidence', 'site', 'app', 'bench', 'gate', '.github']);

export async function runGate({ randomCases = 200, seed = 20261024 } = {}) {
  const work = mkdtempSync(resolve(tmpdir(), 'seyrin-gate-'));
  cpSync(ROOT, work, { recursive: true, filter: (src) => !SKIP.has(src.slice(ROOT.length + 1).split('/')[0]) });
  cpSync(resolve(ROOT, 'bench/deep/fakes'), resolve(work, 'fakes'), { recursive: true });
  const { FIXTURES } = await import(resolve(ROOT, 'app/src/fixtures.ts'));
  const mail = Object.fromEntries(FIXTURES.map((f) => [f.threadId, f]));

  const files = { kanePlan: resolve(work, 'kane-plan.json'), kaneLog: resolve(work, 'kane-log.ndjson'), agentPlan: resolve(work, 'agent-plan.json'), agentLog: resolve(work, 'agent-log.ndjson') };
  Object.assign(process.env, { KANE_CLI_BIN: 'fakes/scripted-kane.mjs', SCRIPTED_KANE_PLAN: files.kanePlan, SCRIPTED_KANE_LOG: files.kaneLog, SCRIPTED_AGENT_PLAN: files.agentPlan, SCRIPTED_AGENT_LOG: files.agentLog });
  delete process.env.OPENAI_API_KEY;
  delete process.env.KANEHACK_REPORT;

  const { loadConfig } = await import(resolve(work, 'server/config.mjs'));
  const core = await import(resolve(work, 'core/index.ts'));
  const { createTasks } = await import(resolve(work, 'server/tasks.mjs'));
  const config = loadConfig();
  config.server.headed = false;
  config.apps[0].fixAgent = [process.execPath, resolve(work, 'fakes/scripted-agent.mjs'), '{prompt}'];
  const tasks = createTasks({ config, core, baseUrl: 'http://127.0.0.1:4477' });
  const pricingFile = resolve(config.apps[0].repo, 'public/pricing.js');
  const pristine = readFileSync(pricingFile, 'utf8');

  const readLog = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const TERMINAL = ['done', 'failed', 'error', 'refused', 'needs_info', 'reproduced', 'not_reproduced', 'awaiting_approval'];
  async function settle(id, phases = TERMINAL) {
    for (const until = Date.now() + 60_000; Date.now() < until; ) {
      const t = tasks.get(id);
      if (phases.includes(t.phase)) return t;
      await new Promise((r) => setTimeout(r, 15));
    }
    return { ...tasks.get(id), hung: true };
  }
  let seq = 0;
  /** One task from email to its end state, with the scripted Kane and agent results. */
  async function play({ fixture, kane, agent = [], approve = false, fix = false, undo = false }) {
    writeFileSync(files.kanePlan, JSON.stringify(kane));
    writeFileSync(files.agentPlan, JSON.stringify(agent));
    rmSync(files.kaneLog, { force: true });
    rmSync(files.agentLog, { force: true });
    writeFileSync(pricingFile, pristine);
    const f = mail[fixture];
    const { task } = tasks.create({ threadId: `${fixture}-${(seq += 1)}`, subject: f.subject, from: f.from, bodyText: f.bodyText });
    let t = await settle(task.id);
    if (approve && t.phase === 'awaiting_approval') {
      tasks.approve(t.id);
      t = await settle(t.id, ['done', 'failed', 'error']);
    }
    if (fix && t.phase === 'reproduced') {
      tasks.fix(t.id);
      // fix() returns before the loop starts; wait for it to leave 'reproduced'.
      await new Promise((r) => setTimeout(r, 20));
      t = await settle(t.id, ['done', 'failed', 'error']);
    }
    const raw = tasks.get(t.id);
    let undone = null;
    if (undo && raw.undo?.available) {
      tasks.undo(t.id);
      undone = readFileSync(pricingFile, 'utf8') === pristine;
    }
    const internal = raw;
    return { task: internal, hung: !!t.hung, kaneCalls: readLog(files.kaneLog), agentCalls: readLog(files.agentLog), undone };
  }

  /** The gate's rules, checked on every run. */
  function invariants(r, { loopRuns }) {
    const runs = r.task.runs || [];
    const last = runs.at(-1);
    const broken = [];
    if (r.hung) broken.push('task never reached an end state');
    if (r.task.phase === 'done' && last?.runEnd?.status !== 'passed') broken.push(`called done after a Kane run that did not pass (${r.kaneCalls.at(-1)?.outcome})`);
    if (r.task.phase === 'done' && !r.task.result?.verified) broken.push('done without result.verified');
    if ((r.task.work?.attempts?.length || 0) > 3) broken.push('more than 3 agent attempts');
    if (r.kaneCalls.length > loopRuns) broken.push(`more than ${loopRuns} Kane runs`);
    // Kane's failure must be in the next prompt the agent sees.
    const attempts = r.task.work?.attempts || [];
    for (let i = 1; i < r.agentCalls.length; i += 1) {
      const prev = attempts[i - 1];
      if (prev?.verdict && prev.verdict !== 'error' && prev.detail && !r.agentCalls[i].prompt.includes(prev.detail)) broken.push(`attempt ${i + 1} prompt lacks Kane's finding`);
    }
    // An agent that failed and changed nothing must not cost a Kane run (codeLoop's own rule).
    const codeKane = r.kaneCalls.filter((c) => c.name).length;
    const worth = r.agentCalls.filter((c) => c.action !== 'fail').length;
    if (r.agentCalls.length && codeKane !== worth) broken.push('[efficiency] ' + `${codeKane} Kane runs for ${worth} attempts that could have changed something`);
    return broken;
  }

  const results = [];
  const record = (group, name, expect, r, opts) => {
    const broken = invariants(r, opts);
    results.push({ group, name, expect, phase: r.task.phase, kaneRuns: r.kaneCalls.length, agentRuns: r.agentCalls.length, attempts: r.task.work?.attempts?.length || 0, verdicts: r.kaneCalls.map((c) => c.outcome), asExpected: r.task.phase === expect, broken, undone: r.undone, regressionTest: r.task.regressionTest || null, bugDetection: r.kaneCalls[0]?.bugDetection ?? null });
  };

  // A. Reproduce a bug report: every kind of Kane result.
  const OUTCOMES = { pass: 'not_reproduced', bug740: 'reproduced', fail: 'reproduced', timeout3: 'error', error2: 'error', crash: 'error', garbage: 'error', silent0: 'error', endNoStatus0: 'not_reproduced', passedExit1: 'not_reproduced' };
  for (const [kane, expect] of Object.entries(OUTCOMES)) {
    record('Reproduce (Maya\'s bug report)', kane, expect, await play({ fixture: 'demo-maya-upgrade', kane: [kane] }), { loopRuns: 1 });
  }

  // B. Fix loop: agent edits, Kane re-checks, failure goes back, ≤ 3 rounds.
  const FIX = [
    ['pass first time', ['pass'], ['edit'], 'done'],
    ['fail, then pass', ['fail', 'pass'], ['edit', 'edit'], 'done'],
    ['fail, fail, pass', ['fail', 'fail', 'pass'], ['edit', 'edit', 'edit'], 'done'],
    ['fails 3 times', ['fail', 'fail', 'fail'], ['edit', 'edit', 'edit'], 'failed'],
    ['740 three times', ['bug740', 'bug740', 'bug740'], ['edit', 'edit', 'edit'], 'failed'],
    ['Kane error, then pass', ['error2', 'pass'], ['edit', 'edit'], 'done'],
    ['times out 3 times', ['timeout3', 'timeout3', 'timeout3'], ['edit', 'edit', 'edit'], 'failed'],
    ['agent makes no change, then fixes', ['pass'], ['fail', 'edit'], 'done'],
    ['agent never changes anything', [], ['fail', 'fail', 'fail'], 'failed'],
    ['Kane exits 0 with no result', ['silent0'], ['edit'], 'failed'],
    ['run_end passed but exit 1', ['passedExit1', 'pass'], ['edit', 'edit'], 'done'],
  ];
  for (const [name, kane, agent, expect] of FIX) {
    record('Fix loop (after a 740 reproduce)', name, expect, await play({ fixture: 'demo-maya-upgrade', kane: ['bug740', ...kane], agent, fix: true }), { loopRuns: 4 });
  }

  // C. Document: written by the built-in template writer (no OpenAI), checked by Kane, rewritten on failure.
  const DOC = [['pass first time', ['pass'], 'done'], ['fail, then pass', ['fail', 'pass'], 'done'], ['fails 3 times', ['fail', 'fail', 'fail'], 'failed'], ['Kane error', ['error2'], 'error'], ['Kane exits 0 with no result', ['silent0'], 'error']];
  for (const [name, kane, expect] of DOC) record('Document', name, expect, await play({ fixture: 'demo-jordan-doc', kane }), { loopRuns: 3 });

  // D. Site change: waits for approval, then the same loop; Undo must restore the file byte for byte.
  const SITE = [['approve, fail, pass, undo', ['fail', 'pass'], ['edit', 'edit'], 'done'], ['approve, fails 3 times, undo', ['fail', 'fail', 'fail'], ['edit', 'edit', 'edit'], 'failed']];
  for (const [name, kane, agent, expect] of SITE) record('Site change', name, expect, await play({ fixture: 'seyrin-pro-price', kane, agent, approve: true, undo: true }), { loopRuns: 3 });
  const before = await play({ fixture: 'seyrin-pro-price', kane: [], agent: [] });
  results.push({ group: 'Site change', name: 'not approved', expect: 'awaiting_approval', phase: before.task.phase, kaneRuns: before.kaneCalls.length, agentRuns: before.agentCalls.length, attempts: 0, verdicts: [], asExpected: before.task.phase === 'awaiting_approval' && before.kaneCalls.length === 0 && before.agentCalls.length === 0, broken: before.kaneCalls.length || before.agentCalls.length ? ['ran before approval'] : [] });

  // E. Random sequences through the fix loop, seeded so the run is repeatable.
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const KANE_POOL = ['pass', 'fail', 'bug740', 'timeout3', 'error2', 'crash', 'garbage', 'passedExit1'];
  const AGENT_POOL = ['edit', 'edit', 'edit', 'noop', 'fail'];
  const random = { cases: 0, broken: [], phases: {}, kaneRuns: 0, withSilent: { cases: 0, broken: 0 } };
  for (let i = 0; i < randomCases; i += 1) {
    const withSilent = i % 10 === 9; // 1 case in 10 may include Kane's "exit 0, no run_end"
    const pool = withSilent ? [...KANE_POOL, 'silent0'] : KANE_POOL;
    const kane = Array.from({ length: 3 }, () => pick(pool));
    const agent = Array.from({ length: 3 }, () => pick(AGENT_POOL));
    const r = await play({ fixture: 'demo-maya-upgrade', kane: ['bug740', ...kane], agent, fix: true });
    const broken = invariants(r, { loopRuns: 4 });
    random.cases += 1;
    random.kaneRuns += r.kaneCalls.length;
    random.phases[r.task.phase] = (random.phases[r.task.phase] || 0) + 1;
    if (withSilent) random.withSilent.cases += 1;
    if (broken.length) {
      if (withSilent) random.withSilent.broken += 1;
      random.broken.push({ kane: r.kaneCalls.map((c) => c.outcome), agent: r.agentCalls.map((c) => c.action), phase: r.task.phase, broken });
    }
  }

  // tasks.mjs persists on a 200 ms timer; let the last write land before deleting the copy.
  await new Promise((r) => setTimeout(r, 500));
  rmSync(work, { recursive: true, force: true });
  return { results, random, seed };
}

export function gateMarkdown({ results, random, seed }) {
  const md = [];
  const safety = (list) => list.filter((b) => !b.startsWith('[efficiency]'));
  const waste = (list) => list.filter((b) => b.startsWith('[efficiency]'));
  const fixed = results;
  const asExpected = fixed.filter((r) => r.asExpected && !safety(r.broken).length).length;
  const randomSafe = random.cases - random.broken.filter((b) => safety(b.broken).length).length;
  const randomWaste = random.broken.filter((b) => waste(b.broken).length).length;
  md.push('## 3. The Kane gate under fault injection', '');
  md.push('**Claim tested** (README, Kane CLI in Seyrin): "Every task ends in a `kane-cli run --agent` whose `run_end` decides Done, Reproduced or Retry"; "Kane\'s failure is the agent\'s next prompt, for up to 3 rounds"; Undo restores the code; nothing that changes code runs before approval. The 6.1-minute benchmark showed 5 of 5 tasks gated on real runs; this checks the same code against every result Kane could return, including bad ones.', '');
  md.push('**Method:** the unmodified `server/tasks.mjs` runs in a throwaway copy of the repo. `kane-cli` is replaced by `bench/deep/fakes/scripted-kane.mjs`, which plays back a scripted result per run, and the coding agent by `fakes/scripted-agent.mjs`. **This is not Kane and no browser opens**: it tests Seyrin\'s decisions about Kane\'s results, not Kane\'s ability to find bugs (the real runs KR-57 to KR-65 show that). Safety rules checked on every run: done only after a run whose `run_end` says passed; at most 3 agent attempts and 3 Kane runs per loop; Kane\'s finding appears in the next agent prompt; nothing runs before approval. Efficiency rule: no Kane run is spent on an attempt where the agent failed.', '');
  md.push('| Measure | Result |', '|---|---|');
  md.push(`| Scripted scenarios ending in the expected state, safety rules held | **${asExpected} / ${fixed.length}** |`);
  md.push(`| Random fix-loop sequences (seed ${seed}), safety rules held | **${randomSafe} / ${random.cases}** |`);
  md.push(`| ...random sequences that included Kane exiting 0 with no \`run_end\` | ${random.withSilent.cases}, of which ${random.withSilent.broken} broke a rule |`);
  md.push(`| Random sequences that spent a Kane run on a failed agent attempt (efficiency) | ${randomWaste} / ${random.cases} |`);
  md.push(`| Kane results played back | ${fixed.reduce((a, r) => a + r.kaneRuns, 0) + random.kaneRuns} |`);
  md.push(`| Reproduce runs that asked Kane for bug detection (\`--bug-detection stop\`) | ${fixed.filter((r) => r.group.startsWith('Reproduce') && r.bugDetection === 'stop').length} / ${fixed.filter((r) => r.group.startsWith('Reproduce')).length} |`, '');
  md.push('| Group | Scenario | Kane results played | Expected | Got | Kane runs | Agent runs | Rules broken |', '|---|---|---|---|---|---|---|---|');
  for (const r of fixed) md.push(`| ${r.group} | ${r.name} | ${r.verdicts.join(' → ') || '–'} | ${r.expect} | ${r.asExpected ? r.phase : `**${r.phase}**`}${r.undone === true ? ', undo restored the file' : r.undone === false ? ', **undo did not restore the file**' : ''} | ${r.kaneRuns} | ${r.agentRuns} | ${r.broken.length ? r.broken.join('; ') : 'none'} |`);
  md.push('', `Random sequences ended: ${Object.entries(random.phases).map(([p, n]) => `${p} ${n}`).join(', ')}.`, '');
  const safetyBreaks = random.broken.filter((b) => safety(b.broken).length);
  if (safetyBreaks.length) {
    md.push('**Random safety breaks:**', '');
    for (const b of safetyBreaks) md.push(`- Kane ${b.kane.join(' → ')}, agent ${b.agent.join(' → ')}, ended ${b.phase}: ${safety(b.broken).join('; ')}`);
    md.push('');
  }
  return md.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await runGate({ randomCases: Number(process.env.GATE_RANDOM || 40) });
  console.log(gateMarkdown(out));
}
