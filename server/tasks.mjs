// Tasks: an email asks for something → policy → agent does it → Kane proves it → reply drafted.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, ROOT } from './config.mjs';
import { extractSpec } from './extract.mjs';
import { createKaneRunner, SHOTS } from './kane.mjs';
import { agentLabel, agentReady, diffAgainst, restore, runAgent, snapshot } from './agents.mjs';
import { clearDocs, deleteDoc, saveDoc, writeDocument } from './docs.mjs';

const MAX_ATTEMPTS = 3;
const STORE = resolve(DATA_DIR, 'tasks.json');
const AUDIT = resolve(DATA_DIR, 'audit.ndjson');
const BUSY = ['understanding', 'working', 'verifying'];

export function createTasks({ config, core, baseUrl }) {
  mkdirSync(DATA_DIR, { recursive: true });
  const kane = createKaneRunner({ config });
  const tasks = new Map();
  const listeners = new Map();
  const globalListeners = new Set();
  let saveTimer = null;

  try {
    for (const task of JSON.parse(readFileSync(STORE, 'utf8'))) {
      // Work that was in flight when the server stopped is not coming back.
      if (BUSY.includes(task.phase)) Object.assign(task, { phase: 'error', detail: 'Seyrin restarted during this task. Run it again.' });
      tasks.set(task.id, task);
    }
  } catch {}

  const origins = () => config.apps.flatMap((app) => app.origins);
  const appForUrl = (url) => {
    if (!url) return null;
    try {
      const origin = new URL(url).origin;
      return config.apps.find((app) => app.origins.some((o) => new URL(o).origin === origin)) || null;
    } catch {
      return null;
    }
  };
  const policyInput = { people: config.people, teamDomains: config.teamDomains };

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => writeFileSync(STORE, JSON.stringify([...tasks.values()], null, 2)), 200);
  }

  function view(task) {
    const app = config.apps.find((a) => a.id === task.appId);
    return {
      ...task,
      app: app ? { id: app.id, name: app.name, canFix: Boolean(app.repo && app.fixAgent) } : null,
      run: task.run ? strip(task.run) : null,
      runs: task.runs.map(strip),
    };
  }
  const strip = (run) => ({ ...run, stderr: undefined, sessionDir: undefined });

  function emit(task, kind, payload) {
    task.updatedAt = new Date().toISOString();
    persist();
    const state = kind === 'state' ? view(task) : null;
    for (const fn of listeners.get(task.id) || []) fn(kind, state || payload);
    for (const fn of globalListeners) fn(kind, state ? { id: task.id, threadId: task.threadId, kind: task.kind, phase: task.phase } : { id: task.id, ...payload });
  }
  const changed = (task) => emit(task, 'state');

  function log(task, source, text) {
    const entry = { ts: new Date().toISOString(), source, text };
    task.log.push(entry);
    if (task.log.length > 500) task.log.splice(0, task.log.length - 500);
    appendFileSync(AUDIT, JSON.stringify({ ...entry, task: task.id, thread: task.threadId, kind: task.kind }) + '\n');
    emit(task, 'log', entry);
  }

  function phase(task, next, detail) {
    task.phase = next;
    if (detail !== undefined) task.detail = detail;
    changed(task);
  }

  async function kaneCheck(task, { objective, url, name, cwd, label, keepEvidence }) {
    const attempt = task.runs.length + 1;
    log(task, 'kane', `kane-cli run ${JSON.stringify(objective)}${name ? ` --name ${name}` : ''}`);
    const run = await kane.run(
      { objective, url, name, cwd, label, attempt, keepEvidence },
      {
        onStart: (r) => {
          task.run = r;
          task.runs.push(r);
          changed(task);
        },
        onLine: (line) => emit(task, 'kane', { line, label }),
        onStep: () => changed(task),
      },
    );
    const verdict = core.verdictFromRun(run.exitCode, run.runEnd);
    if (verdict.verdict === 'error' && !run.runEnd && /log ?in|auth|credential|token/i.test(run.stderr)) {
      verdict.detail = 'Kane CLI is not signed in. Run `kane-cli login` and try again.';
    }
    return { run, ...verdict };
  }

  // ── Understanding and policy ────────────────────────────────────────────────

  async function understand(task) {
    const { spec, extractor, warning } = await extractSpec({ kind: task.kind, email: task.email, origins: origins(), core });
    task.spec = spec;
    task.extractor = extractor;
    if (warning) log(task, 'seyrin', warning);
    const docUrl = `${baseUrl}/d/${encodeURIComponent(task.id.slice(0, 8))}`;
    if (task.kind === 'document') {
      task.plan = {
        steps: [
          { label: `Write "${spec.title}" with ${spec.sections.join(', ')}`, tool: 'docs', risk: 'create' },
          { label: 'Open the document in a browser and check every section is there', tool: 'kane', risk: 'read' },
          { label: `Draft a reply to ${firstName(task.requester)} with the link`, tool: 'reply', risk: 'read' },
        ],
        verify: core.compileDocumentCheck(docUrl, spec).replace(docUrl, 'the new document'),
        target: 'Seyrin Docs',
      };
    } else if (task.kind === 'site_change') {
      const app = appForUrl(spec.url);
      task.appId = app?.id || null;
      task.plan = {
        steps: [
          { label: `${upper(spec.change || 'Make the change')} in ${app?.name || 'the site'}`, tool: 'code', risk: 'modify' },
          { label: 'Open the page and check the change is live', tool: 'kane', risk: 'read' },
          { label: `Draft a reply to ${firstName(task.requester)}`, tool: 'reply', risk: 'read' },
        ],
        verify: core.compileSiteCheck(spec),
        target: spec.url,
      };
    } else {
      const app = appForUrl(spec.url);
      task.appId = app?.id || null;
      task.plan = {
        steps: [
          { label: `Follow ${firstName(task.requester)}'s steps on ${spec.url || 'your app'}`, tool: 'kane', risk: 'read' },
          { label: 'If it is a real bug: fix the code, then re-run the same steps (asks you first)', tool: 'code', risk: 'modify' },
          { label: 'Draft a reply that matches what Kane found', tool: 'reply', risk: 'read' },
        ],
        verify: core.compileKaneObjective(spec),
        target: spec.url,
      };
    }
  }

  async function start(task) {
    // A refused task is never planned: nothing about it should look runnable.
    if (task.policy.decision !== 'refuse') {
      phase(task, 'understanding', 'Reading the request…');
      await understand(task);
    }
    if (task.policy.decision === 'refuse') {
      log(task, 'policy', `Refused: ${task.policy.reasons.at(-1)}`);
      task.draftReply = '';
      return phase(task, 'refused', task.policy.reasons.at(-1));
    }
    const missing = missingFor(task);
    if (missing) {
      log(task, 'seyrin', missing);
      task.draftReply = core.draftTaskReply({ kind: task.kind, outcome: 'needs_info', senderName: task.requester.name, ask: task.ask });
      return phase(task, 'needs_info', missing);
    }
    if (task.policy.decision === 'approve') {
      log(task, 'policy', `Waiting for your approval: ${task.policy.reasons.at(-1)}`);
      return phase(task, 'awaiting_approval', 'Seyrin has a plan and needs your OK to run it.');
    }
    log(task, 'policy', `Running automatically: ${task.policy.reasons.at(-1)}`);
    return execute(task);
  }

  function missingFor(task) {
    const spec = task.spec;
    if (task.kind === 'bug_report' && (!spec.url || !task.plan.verify)) {
      const foreign = core.foreignHosts(`${task.email.subject}\n${task.email.bodyText}`, origins());
      return foreign.length ? `Kane did not open ${foreign.join(', ')}: it is not one of your apps.` : 'The email does not say which page on your app, so Kane has nothing to open.';
    }
    if (task.kind === 'site_change' && (!spec.url || !task.plan.verify)) return 'Seyrin could not tell which page to change, or how to check it.';
    return null;
  }

  async function execute(task) {
    try {
      if (task.kind === 'document') await doDocument(task);
      else if (task.kind === 'site_change') await doSiteChange(task);
      else await doReproduce(task);
    } catch (error) {
      log(task, 'seyrin', `Error: ${error.message}`);
      phase(task, 'error', error.message);
    }
  }

  // ── Document ────────────────────────────────────────────────────────────────

  async function doDocument(task) {
    let feedback = null;
    task.work = { agent: process.env.OPENAI_API_KEY ? 'openai' : 'template', attempts: [] };
    for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
      phase(task, 'working', n === 1 ? 'Writing the document…' : `Rewriting: ${feedback}`);
      const { markdown, writer } = await writeDocument({ spec: task.spec, email: task.email, knowledge: config.knowledge, me: config.me, feedback, log: (t) => log(task, 'agent', t) });
      const doc = saveDoc({ title: task.spec.title, markdown, taskId: task.id, requester: task.requester.name || task.requester.email, createdAt: task.createdAt, writer });
      task.docSlug = doc.slug;
      const link = `${baseUrl}/d/${doc.slug}`;
      log(task, 'agent', `Saved "${doc.title}" to Seyrin Docs (${writer}).`);
      const attempt = { n, agentExitCode: 0, summary: `Wrote ${task.spec.sections.length} sections (${writer}).`, diff: '', verdict: null, detail: '' };
      task.work.attempts.push(attempt);
      task.undo = { available: true, label: 'Delete the document' };
      phase(task, 'verifying', 'Kane is opening the document…');
      const objective = core.compileDocumentCheck(link, task.spec);
      const check = await kaneCheck(task, { objective, url: link, label: n === 1 ? 'Check the document' : `Re-check ${n}`, keepEvidence: `doc-${doc.slug}-${n}` });
      attempt.verdict = check.verdict;
      attempt.detail = check.detail;
      if (check.verdict === 'not_reproduced') {
        const facts = core.keyFacts(task.spec.context);
        const proof = `Kane opened it in a browser and found all ${task.spec.sections.length} sections (${task.spec.sections.join(', ')})${facts.length ? ` and the details you gave (${facts.join(', ')})` : ''}`;
        task.result = { verified: true, link, proof };
        task.draftReply = core.draftTaskReply({ kind: 'document', outcome: 'done', senderName: task.requester.name, link, proof, ask: task.ask });
        log(task, 'seyrin', `Done and verified by Kane: ${proof}`);
        return phase(task, 'done', 'Written, and Kane checked it in a browser.');
      }
      if (check.verdict === 'error') return phase(task, 'error', check.detail);
      feedback = check.detail;
      log(task, 'kane', `Check failed: ${check.detail}`);
    }
    task.result = { verified: false, link: task.docSlug ? `${baseUrl}/d/${task.docSlug}` : null, proof: null };
    phase(task, 'failed', 'Kane still found problems after 3 drafts. Have a look before sending it.');
  }

  // ── Site change ─────────────────────────────────────────────────────────────

  async function doSiteChange(task) {
    const app = config.apps.find((a) => a.id === task.appId);
    if (!app?.repo || !app.fixAgent) throw new Error('This site has no repository or coding agent configured.');
    if (!agentReady(app.fixAgent)) throw new Error(`The ${agentLabel(app.fixAgent)} agent is not ready (for OpenAI, add OPENAI_API_KEY to seyrin/.env).`);
    snapshot(app.repo, task.id);
    task.undo = { available: true, label: 'Revert the change' };
    await codeLoop(task, app, {
      first: (n) => [`A teammate asked for a change to this site: "${task.spec.change}".`, `When it's done, this check must pass in a browser: ${task.plan.verify}`, n > 1 ? '' : ''].join('\n'),
      name: `change_${slug(task.threadId)}`,
      label: 'Check the change',
      done: (proof) => {
        task.result = { verified: true, link: task.spec.url, proof };
        task.draftReply = core.draftTaskReply({ kind: 'site_change', outcome: 'done', senderName: task.requester.name, link: task.spec.url, proof, ask: task.ask });
      },
    });
  }

  // ── Bug report ──────────────────────────────────────────────────────────────

  async function doReproduce(task) {
    const app = config.apps.find((a) => a.id === task.appId);
    phase(task, 'verifying', `Kane is following ${firstName(task.requester)}'s steps…`);
    const check = await kaneCheck(task, { objective: task.plan.verify, url: task.spec.url, cwd: app?.repo || ROOT, label: 'Reproduce', keepEvidence: `repro-${slug(task.threadId)}` });
    task.verdict = check.verdict;
    task.draftReply = core.draftReproReply({ verdict: check.verdict, spec: task.spec, senderName: task.requester.name });
    if (check.verdict === 'reproduced') {
      task.fixPolicy = core.decide({ kind: 'bug_report', stage: 'fix', trust: task.trust, email: task.email, allowedOrigins: origins() });
      log(task, 'kane', `Reproduced: ${check.detail}`);
      return phase(task, 'reproduced', check.detail);
    }
    if (check.verdict === 'not_reproduced') return phase(task, 'not_reproduced', `Kane followed the steps and it worked: ${check.detail}`);
    return phase(task, 'error', check.detail);
  }

  /** Why the app's coding agent can't run right now, or null when it can. */
  function agentBlocked(task) {
    const app = config.apps.find((a) => a.id === task.appId);
    if (!app?.repo || !app.fixAgent) return 'This app has no repository or coding agent configured.';
    if (!agentReady(app.fixAgent)) return `The ${agentLabel(app.fixAgent)} agent is not ready (for OpenAI, add OPENAI_API_KEY to seyrin/.env).`;
    return null;
  }

  async function doFix(task) {
    const app = config.apps.find((a) => a.id === task.appId);
    if (!app?.repo || !app.fixAgent) throw new Error('This app has no repository or coding agent configured.');
    if (!agentReady(app.fixAgent)) throw new Error(`The ${agentLabel(app.fixAgent)} agent is not ready (for OpenAI, add OPENAI_API_KEY to seyrin/.env).`);
    snapshot(app.repo, task.id);
    task.undo = { available: true, label: 'Revert the fix' };
    await codeLoop(task, app, {
      first: () => [
        'A customer reported a bug in this app by email, and Kane CLI reproduced it in a real browser.',
        `What the customer says happens: ${task.spec.actual || task.spec.summary}`,
        `The check that must pass: ${task.plan.verify}`,
        `Kane's result: ${task.detail}`,
      ].join('\n'),
      name: `regression_${slug(task.threadId)}`,
      label: 'Verify the fix',
      done: (proof) => {
        task.result = { verified: true, link: task.spec.url, proof };
        task.draftReply = core.draftReproReply({ verdict: 'fixed', spec: task.spec, senderName: task.requester.name });
      },
    });
  }

  /** Agent changes code, Kane re-checks; Kane's failure goes back to the agent, up to 3 rounds. */
  async function codeLoop(task, app, { first, name, label, done }) {
    task.work = { agent: agentLabel(app.fixAgent), attempts: [] };
    let feedback = null;
    for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
      phase(task, 'working', n === 1 ? `${upper(agentLabel(app.fixAgent))} is changing the code…` : `Trying again with Kane's feedback (attempt ${n} of ${MAX_ATTEMPTS})…`);
      const prompt = [
        first(n),
        feedback ? `\nAttempt ${n} of ${MAX_ATTEMPTS}. Your previous change did not pass. Kane CLI reported: ${feedback.detail}${feedback.steps.length ? `\nFailed step: ${feedback.steps.join(' | ')}` : ''}${feedback.summary ? `\nYou said last time: ${feedback.summary}` : ''}` : '',
        '\nMake the smallest correct change to the application code. The app is static files in public/, served without a build step. Do not edit anything under .testmuai/ or .claude/, and do not weaken behaviour to make the check pass. Reply with one sentence on what you changed.',
      ].join('\n');
      const result = await runAgent({ agent: app.fixAgent, repo: app.repo, prompt, log: (t) => log(task, 'agent', t) });
      const attempt = { n, agentExitCode: result.code, summary: result.summary, diff: diffAgainst(app.repo, task.id), verdict: null, detail: '' };
      task.work.attempts.push(attempt);
      if (result.code !== 0 && !attempt.diff) {
        // Nothing changed, so a Kane run would only repeat the last result.
        attempt.verdict = 'error';
        attempt.detail = 'The agent did not change anything.';
        log(task, 'seyrin', `Attempt ${n}: the agent made no change; not spending a Kane run on it.`);
        feedback = { detail: feedback?.detail || task.detail, steps: feedback?.steps || [], summary: result.summary };
        continue;
      }
      phase(task, 'verifying', 'Kane is checking the change in a browser…');
      const check = await kaneCheck(task, { objective: task.plan.verify, url: task.spec.url, name, cwd: app.repo, label: n === 1 ? label : `${label} (${n})`, keepEvidence: `${name}-${n}` });
      attempt.verdict = check.verdict;
      attempt.detail = check.detail;
      if (check.verdict === 'not_reproduced') {
        const proof = check.run.runEnd?.one_liner || 'Kane re-ran the steps and the check passed.';
        done(proof);
        const test = resolve(app.repo, '.testmuai/tests', `${name}_test.md`);
        task.regressionTest = existsSync(test) ? relative(ROOT, test) : null;
        log(task, 'seyrin', `Done and verified by Kane on attempt ${n}: ${proof}${task.regressionTest ? ` Saved regression test ${task.regressionTest}.` : ''}`);
        return phase(task, 'done', `Changed, and Kane checked it in a browser on attempt ${n}.`);
      }
      rmSync(resolve(app.repo, '.testmuai/tests', `${name}_test.md`), { force: true });
      rmSync(resolve(app.repo, '.testmuai/tests', `output-${name}`), { recursive: true, force: true });
      if (check.verdict === 'error') log(task, 'kane', `Kane could not check attempt ${n}: ${check.detail}`);
      feedback = { detail: check.detail, steps: (check.run.steps || []).filter((s) => s.status === 'failed').map((s) => s.remark), summary: result.summary };
    }
    log(task, 'seyrin', `Still failing after ${MAX_ATTEMPTS} attempts. Escalating to you.`);
    phase(task, 'failed', `Kane still saw the problem after ${MAX_ATTEMPTS} attempts. This one needs you.`);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    list: () => [...tasks.values()].map(view),
    get: (id) => (tasks.has(id) ? view(tasks.get(id)) : null),
    byThread: (threadId) => {
      const found = [...tasks.values()].filter((t) => t.threadId === threadId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return found ? view(found) : null;
    },
    subscribe(id, fn) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(fn);
      return () => listeners.get(id)?.delete(fn);
    },
    subscribeAll(fn) {
      globalListeners.add(fn);
      return () => globalListeners.delete(fn);
    },
    /** Returns the task, or null when the email asks for nothing Seyrin does. */
    create(email, { rerun = false } = {}) {
      const existing = [...tasks.values()].find((t) => t.threadId === email.threadId);
      if (existing && (!rerun || BUSY.includes(existing.phase))) return { task: view(existing) };
      const intent = core.classifyRequest(email);
      if (!intent.kind) return { none: intent.reason };
      const trust = core.trustOf(email.from, policyInput);
      const policy = core.decide({ kind: intent.kind, trust, email, allowedOrigins: origins() });
      const now = new Date().toISOString();
      const task = {
        id: existing?.id || randomUUID(),
        threadId: email.threadId,
        createdAt: now,
        updatedAt: now,
        email: { threadId: email.threadId, subject: email.subject || '', from: email.from, bodyText: email.bodyText || '' },
        kind: intent.kind,
        ask: intent.ask,
        requester: { name: email.from.name || trust.person?.name, email: email.from.email, trust: trust.trust, role: trust.person?.role || null },
        trust,
        policy,
        fixPolicy: null,
        phase: 'understanding',
        detail: '',
        spec: null,
        plan: null,
        extractor: null,
        appId: null,
        run: null,
        runs: [],
        work: null,
        result: null,
        undo: null,
        draftReply: '',
        log: [],
      };
      tasks.set(task.id, task);
      log(task, 'policy', `${upper(intent.kind.replace('_', ' '))} from ${task.requester.name || task.requester.email} (${trust.trust}). ${policy.reasons.map((r) => r.replace(/[.\s]*$/, '.')).join(' ')}`);
      start(task).catch((error) => phase(task, 'error', error.message));
      return { task: view(task) };
    },
    approve(id) {
      const task = tasks.get(id);
      if (!task) return null;
      if (task.phase !== 'awaiting_approval') return view(task);
      // A site change needs the coding agent; refuse up front instead of failing after the approval.
      if (task.kind === 'site_change') {
        const blocked = agentBlocked(task);
        if (blocked) return { blocked };
      }
      log(task, 'policy', 'You approved the plan.');
      execute(task);
      return view(task);
    },
    dismiss(id) {
      const task = tasks.get(id);
      if (!task) return null;
      if (!BUSY.includes(task.phase)) {
        log(task, 'policy', 'You dismissed this task.');
        phase(task, 'dismissed', 'Dismissed. Nothing was done.');
      }
      return view(task);
    },
    fix(id) {
      const task = tasks.get(id);
      if (!task) return null;
      if (task.phase !== 'reproduced' && !(task.phase === 'failed' && task.kind === 'bug_report')) return view(task);
      const blocked = agentBlocked(task);
      if (blocked) return { blocked };
      log(task, 'policy', 'You approved the fix.');
      doFix(task).catch((error) => {
        log(task, 'seyrin', `Error: ${error.message}`);
        phase(task, 'error', error.message);
      });
      return view(task);
    },
    undo(id) {
      const task = tasks.get(id);
      if (!task?.undo?.available) return task ? view(task) : null;
      if (task.kind === 'document' && task.docSlug) deleteDoc(task.docSlug);
      else {
        const app = config.apps.find((a) => a.id === task.appId);
        if (app?.repo) {
          restore(app.repo, task.id);
          for (const prefix of ['change_', 'regression_']) {
            const name = `${prefix}${slug(task.threadId)}`;
            rmSync(resolve(app.repo, '.testmuai/tests', `${name}_test.md`), { force: true });
            rmSync(resolve(app.repo, '.testmuai/tests', `output-${name}`), { recursive: true, force: true });
          }
          task.regressionTest = null;
        }
      }
      task.undo = { available: false, label: task.undo.label };
      task.result = task.result ? { ...task.result, verified: false } : null;
      log(task, 'policy', `Undone: ${task.undo.label.toLowerCase()}.`);
      phase(task, 'undone', 'Undone. Everything is back the way it was.');
      return view(task);
    },
    editSpec(id, spec) {
      const task = tasks.get(id);
      if (!task || BUSY.includes(task.phase)) return task ? view(task) : null;
      const o = origins();
      task.spec = task.kind === 'document' ? core.finaliseDocument(spec) : task.kind === 'site_change' ? core.finaliseSiteChange(spec, o) : core.finaliseSpec({ ...spec, subject: task.email.subject }, o);
      log(task, 'policy', 'You edited the plan.');
      start(task).catch((error) => phase(task, 'error', error.message));
      return view(task);
    },
    evidencePack(id, attempt) {
      const task = tasks.get(id);
      const run = task?.runs.find((r) => r.attempt === Number(attempt)) || task?.run;
      return run?.evidencePack || null;
    },
    screenshot(file) {
      const path = resolve(SHOTS, String(file).replace(/[^\w.-]/g, ''));
      return existsSync(path) ? path : null;
    },
    reset() {
      tasks.clear();
      persist();
      clearDocs();
      rmSync(SHOTS, { recursive: true, force: true });
      mkdirSync(SHOTS, { recursive: true });
      rmSync(resolve(DATA_DIR, 'snapshots'), { recursive: true, force: true });
      for (const fn of globalListeners) fn('reset', {});
    },
  };
}

function firstName(person) {
  return (person?.name || person?.email || 'them').split(/[\s@]/)[0];
}

function upper(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

function slug(text) {
  return String(text).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'thread';
}
