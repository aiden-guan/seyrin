// Coding agents that change an app's code: the built-in OpenAI agent, Claude Code, Codex, or any command.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { resolve, relative, extname, sep, basename, dirname } from 'node:path';
import { DATA_DIR, findClaude, findOnPath } from './config.mjs';

const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.json', '.md']);
const SKIP = new Set(['.git', '.testmuai', '.claude', 'node_modules', '.data', 'dist', 'evidence']);
const MAX_BYTES = 200 * 1024;

export function agentReady(agent) {
  if (agent === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  if (agent === 'claude') return Boolean(findClaude());
  if (agent === 'codex') return Boolean(findOnPath('codex'));
  return Array.isArray(agent);
}

export function agentLabel(agent) {
  return Array.isArray(agent) ? 'custom' : agent;
}

function appFiles(repo) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const path = resolve(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (TEXT.has(extname(name)) && info.size < 64 * 1024) out.push(path);
    }
  };
  walk(repo);
  return out;
}

/** Copy the app's source before an agent touches it, so Undo can put it back exactly. */
export function snapshot(repo, id) {
  const dir = resolve(DATA_DIR, 'snapshots', id);
  rmSync(dir, { recursive: true, force: true });
  for (const file of appFiles(repo)) {
    const target = resolve(dir, relative(repo, file));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  return dir;
}

export function restore(repo, id) {
  const dir = resolve(DATA_DIR, 'snapshots', id);
  if (!existsSync(dir)) return false;
  const saved = new Set();
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const path = resolve(d, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const rel = relative(dir, path);
        saved.add(rel);
        cpSync(path, resolve(repo, rel));
      }
    }
  };
  walk(dir);
  // Files the agent created are removed too.
  for (const file of appFiles(repo)) if (!saved.has(relative(repo, file))) rmSync(file, { force: true });
  return true;
}

/** A unified-ish diff of the app against its snapshot, for the brief. */
export function diffAgainst(repo, id) {
  const dir = resolve(DATA_DIR, 'snapshots', id);
  if (!existsSync(dir)) return '';
  const out = [];
  for (const file of appFiles(repo)) {
    const rel = relative(repo, file);
    const before = existsSync(resolve(dir, rel)) ? readFileSync(resolve(dir, rel), 'utf8').split('\n') : [];
    const after = readFileSync(file, 'utf8').split('\n');
    if (before.join('\n') === after.join('\n')) continue;
    out.push(`--- ${rel}`, `+++ ${rel}`);
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i += 1) {
      if (before[i] === after[i]) continue;
      if (before[i] !== undefined) out.push(`-${i + 1}: ${before[i]}`);
      if (after[i] !== undefined) out.push(`+${i + 1}: ${after[i]}`);
    }
  }
  return out.join('\n').slice(0, 8000);
}

export function runAgent({ agent, repo, prompt, log }) {
  if (agent === 'openai') {
    return runOpenAIAgent({ repo, prompt, log }).catch((error) => {
      log(`OpenAI agent failed: ${error.message}`);
      return { code: 1, summary: '' };
    });
  }
  return new Promise((done) => {
    let cmd;
    let args;
    if (agent === 'claude') {
      cmd = findClaude();
      args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read Edit Write Glob Grep'];
    } else if (agent === 'codex') {
      cmd = findOnPath('codex');
      args = ['exec', '--full-auto', prompt];
    } else if (Array.isArray(agent)) {
      [cmd, ...args] = agent.map((part) => part.replaceAll('{prompt}', prompt));
    }
    if (!cmd) {
      log(`No ${agentLabel(agent)} agent found on this computer.`);
      return done({ code: 127, summary: '' });
    }
    log(`${basename(cmd)} is working…`);
    const child = spawn(cmd, args, { cwd: repo, env: { ...process.env, KANE_GATE_SKIP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let summary = '';
    createInterface({ input: child.stdout }).on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        if (line.trim()) {
          log(line.slice(0, 300));
          summary = line.trim().slice(0, 500);
        }
        return;
      }
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const part of event.message.content) {
          if (part.type === 'text' && part.text?.trim()) log(part.text.trim().slice(0, 300));
          if (part.type === 'tool_use') log(`${{ Read: 'Reading', Edit: 'Editing', Write: 'Writing' }[part.name] || part.name} ${part.input?.file_path ? relative(repo, part.input.file_path) : ''}`.trim());
        }
      }
      if (event.type === 'result' && typeof event.result === 'string') summary = event.result.trim().slice(0, 500);
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', (error) => log(`Could not start the agent: ${error.message}`));
    child.on('close', (code) => {
      if (code && stderr.trim()) log(stderr.trim().split('\n').slice(-2).join(' '));
      done({ code: code ?? 1, summary });
    });
  });
}

const EDITS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diagnosis', 'edits', 'summary'],
  properties: {
    diagnosis: { type: 'string', description: 'What has to change in the code, in one or two sentences.' },
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'find', 'replace'],
        properties: {
          file: { type: 'string', description: 'Path relative to the repository root, exactly as listed.' },
          find: { type: 'string', description: 'Exact existing text to replace. Must appear exactly once in the file.' },
          replace: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', description: 'One sentence: what you changed and why.' },
  },
};

/** Small built-in agent on the OpenAI API: proposes exact search-and-replace edits; Kane decides if they worked. */
async function runOpenAIAgent({ repo, prompt, log }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    log('No OPENAI_API_KEY in seyrin/.env, so the OpenAI agent cannot run.');
    return { code: 1, summary: '' };
  }
  let budget = MAX_BYTES;
  const sources = [];
  for (const file of appFiles(repo)) {
    const text = readFileSync(file, 'utf8');
    if (text.length > budget) break;
    budget -= text.length;
    sources.push(`=== ${relative(repo, file)} ===\n${text}`);
  }
  const model = process.env.OPENAI_FIX_MODEL || 'gpt-5';
  log(`OpenAI ${model} is reading ${sources.length} files…`);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(180000),
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a careful software engineer. Reply only with the JSON the schema asks for. Make the smallest correct change. Never edit tests, .testmuai or .claude files, and never weaken behaviour to make a check pass.' },
        { role: 'user', content: `${prompt}\n\nRepository files:\n\n${sources.join('\n\n')}` },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'edits', strict: true, schema: EDITS_SCHEMA } },
    }),
  });
  if (!response.ok) {
    log(`OpenAI returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return { code: 1, summary: '' };
  }
  const body = await response.json();
  const plan = JSON.parse(body.choices?.[0]?.message?.content || '{}');
  if (plan.diagnosis) log(plan.diagnosis);
  let applied = 0;
  for (const edit of plan.edits || []) {
    const path = resolve(repo, edit.file);
    const rel = relative(repo, path);
    if (rel.startsWith('..') || rel.split(sep).some((part) => SKIP.has(part))) {
      log(`Skipped an edit outside the app: ${edit.file}`);
      continue;
    }
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      log(`Skipped an edit to a missing file: ${edit.file}`);
      continue;
    }
    const count = text.split(edit.find).length - 1;
    if (count !== 1) {
      log(`Skipped an edit to ${rel}: the text to replace appears ${count} times.`);
      continue;
    }
    writeFileSync(path, text.replace(edit.find, () => edit.replace));
    applied += 1;
    log(`Editing ${rel}`);
  }
  return { code: applied ? 0 : 1, summary: plan.summary || '' };
}
