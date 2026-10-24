#!/usr/bin/env node
// Seyrin server (local, 127.0.0.1). Serves the inbox app, runs tasks, and drives Kane CLI.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, watch, openSync, readSync, closeSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, DATA_DIR, loadConfig, loadEnv, kaneCommand, resolveOpenAIModels } from './config.mjs';
import { createTasks } from './tasks.mjs';
import { agentLabel, agentReady } from './agents.mjs';
import { docPage, docsIndexPage, getDoc, listDocs } from './docs.mjs';

loadEnv();
await resolveOpenAIModels();
const config = loadConfig();
mkdirSync(DATA_DIR, { recursive: true });
const core = await import(pathToFileURL(resolve(ROOT, 'core/index.ts')).href);
const baseUrl = `http://localhost:${config.server.port}`;
const tasks = createTasks({ config, core, baseUrl });
const APP = resolve(ROOT, 'app/dist');
const GATE_LOG = resolve(DATA_DIR, 'gate.ndjson');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const evidenceServers = new Map();

function headers(extra = {}) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    'cache-control': 'no-store',
    ...extra,
  };
}

function send(res, status, body) {
  res.writeHead(status, headers({ 'content-type': 'application/json' }));
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 256 * 1024) throw new Error('Body too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function sse(res, onClose) {
  res.writeHead(200, headers({ 'content-type': 'text/event-stream', connection: 'keep-alive' }));
  res.write(': connected\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  res.on('close', () => {
    clearInterval(ping);
    onClose();
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

let kaneInfo = null;
function kaneStatus() {
  if (kaneInfo && Date.now() - kaneInfo.at < 30000) return kaneInfo.value;
  let value = { installed: false };
  try {
    const [cmd, args] = kaneCommand(['--version']);
    value = { installed: true, version: execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }).trim().split('\n').at(-1), fake: Boolean(process.env.KANE_CLI_BIN) };
    const [wcmd, wargs] = kaneCommand(['whoami']);
    value.signedIn = !/not logged in|token\s+missing/i.test(execFileSync(wcmd, wargs, { encoding: 'utf8', timeout: 8000 }));
  } catch {}
  kaneInfo = { at: Date.now(), value };
  return value;
}

function health() {
  return {
    ok: true,
    kane: kaneStatus(),
    openai: Boolean(process.env.OPENAI_API_KEY),
    headed: config.server.headed,
    me: config.me,
    apps: config.apps.map((app) => ({ id: app.id, name: app.name, origins: app.origins, canFix: Boolean(app.repo && app.fixAgent), fixAgent: app.fixAgent ? agentLabel(app.fixAgent) : null, fixReady: app.fixAgent ? agentReady(app.fixAgent) : false })),
    people: config.people.map(({ name, email, trust, role }) => ({ name, email, trust, role: role || null })),
  };
}

// The gate's NDJSON log (hook, watch, check runs) feeds the live console too.
const gateListeners = new Set();
let gateOffset = existsSync(GATE_LOG) ? statSync(GATE_LOG).size : 0;
function pumpGate() {
  if (!existsSync(GATE_LOG)) return;
  const size = statSync(GATE_LOG).size;
  if (size < gateOffset) gateOffset = 0;
  if (size === gateOffset) return;
  const fd = openSync(GATE_LOG, 'r');
  const buffer = Buffer.alloc(size - gateOffset);
  readSync(fd, buffer, 0, buffer.length, gateOffset);
  closeSync(fd);
  gateOffset = size;
  for (const line of buffer.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      for (const fn of gateListeners) fn(event);
    } catch {}
  }
}
setInterval(pumpGate, 500).unref();
try {
  watch(DATA_DIR, () => pumpGate());
} catch {}

async function serveEvidence(pack) {
  if (evidenceServers.has(pack)) return evidenceServers.get(pack);
  const [cmd, args] = kaneCommand(['evidence', 'serve', pack]);
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((done) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk;
      const match = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s"']*/.exec(buffer);
      if (match) done(match[0]);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', () => done(null));
    setTimeout(() => done(null), 15000);
  });
  if (url) evidenceServers.set(pack, url);
  else child.kill();
  return url;
}

function serveFile(res, file) {
  res.writeHead(200, headers({ 'content-type': TYPES[extname(file)] || 'application/octet-stream' }));
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers());
      return res.end();
    }
    if (url.pathname === '/health') return send(res, 200, health());

    if (parts[0] === 'v1' && parts[1] === 'tasks') {
      const id = parts[2];
      const action = parts[3];
      if (!id && req.method === 'GET') {
        const threadId = url.searchParams.get('threadId');
        if (threadId) {
          const found = tasks.byThread(threadId);
          return found ? send(res, 200, found) : send(res, 404, { error: 'none' });
        }
        return send(res, 200, { tasks: tasks.list() });
      }
      if (!id && req.method === 'POST') {
        const body = await readJson(req);
        if (!body.threadId || typeof body.bodyText !== 'string' || !body.from?.email) return send(res, 400, { error: 'threadId, from.email and bodyText are required' });
        const created = tasks.create(body, { rerun: url.searchParams.get('rerun') === '1' });
        return created.task ? send(res, 202, created.task) : send(res, 404, { error: 'no_task', reason: created.none });
      }
      if (id && !action && req.method === 'GET') {
        const found = tasks.get(id);
        return found ? send(res, 200, found) : send(res, 404, { error: 'not found' });
      }
      if (id && !action && req.method === 'PATCH') {
        const body = await readJson(req);
        const found = tasks.editSpec(id, body.spec || {});
        return found ? send(res, 202, found) : send(res, 404, { error: 'not found' });
      }
      if (id && ['approve', 'dismiss', 'fix', 'undo'].includes(action) && req.method === 'POST') {
        const found = tasks[action](id);
        if (found?.blocked) return send(res, 409, { error: found.blocked });
        return found ? send(res, 202, found) : send(res, 404, { error: 'not found' });
      }
      if (id && action === 'stream') {
        const found = tasks.get(id);
        if (!found) return send(res, 404, { error: 'not found' });
        let write;
        const off = tasks.subscribe(id, (kind, data) => write(kind, data));
        write = sse(res, off);
        write('state', found);
        return;
      }
      if (id && action === 'evidence' && req.method === 'POST') {
        const pack = tasks.evidencePack(id, url.searchParams.get('attempt'));
        if (!pack) return send(res, 404, { error: 'No evidence pack for this run yet.' });
        const viewer = await serveEvidence(pack);
        return viewer ? send(res, 200, { viewer }) : send(res, 502, { error: 'Kane did not start the evidence viewer.' });
      }
    }

    if (parts[0] === 'v1' && parts[1] === 'shots' && parts[2]) {
      const file = tasks.screenshot(decodeURIComponent(parts[2]));
      return file ? serveFile(res, file) : send(res, 404, { error: 'not found' });
    }

    if (url.pathname === '/v1/events') {
      let write;
      const offTasks = tasks.subscribeAll((kind, data) => write(kind, data));
      const onGate = (event) => write('gate', event);
      gateListeners.add(onGate);
      write = sse(res, () => {
        offTasks();
        gateListeners.delete(onGate);
      });
      return;
    }

    // Reset the demo: forget every task and document, and put the planted bugs back in Perch.
    if (url.pathname === '/v1/admin/reset' && req.method === 'POST') {
      try {
        execFileSync('git', ['checkout', 'demo-baseline', '--', 'demo-app/public'], { cwd: ROOT, stdio: 'ignore' });
      } catch {}
      execFileSync('sh', ['-c', 'rm -rf demo-app/.testmuai/tests/regression_* demo-app/.testmuai/tests/output-regression_* demo-app/.testmuai/tests/change_* demo-app/.testmuai/tests/output-change_*'], { cwd: ROOT });
      tasks.reset();
      return send(res, 200, { ok: true });
    }

    // Seyrin Docs.
    if (parts[0] === 'd' && req.method === 'GET') {
      if (!parts[1]) {
        res.writeHead(200, headers({ 'content-type': TYPES['.html'] }));
        return res.end(docsIndexPage(listDocs()));
      }
      const doc = getDoc(decodeURIComponent(parts[1]));
      if (!doc) {
        res.writeHead(404, headers({ 'content-type': TYPES['.html'] }));
        return res.end('<!doctype html><title>Not found</title><p>That document does not exist (it may have been undone).</p>');
      }
      res.writeHead(200, headers({ 'content-type': TYPES['.html'] }));
      return res.end(docPage(doc));
    }

    // The inbox app.
    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = resolve(APP, rel);
      if (file.startsWith(APP) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file);
      if (!extname(rel) && existsSync(resolve(APP, 'index.html'))) {
        res.writeHead(200, headers({ 'content-type': TYPES['.html'] }));
        return res.end(readFileSync(resolve(APP, 'index.html')));
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(config.server.port, '127.0.0.1', () => {
  const h = health();
  console.log(`Seyrin on http://127.0.0.1:${config.server.port}`);
  console.log(`  Kane CLI: ${h.kane.installed ? `${h.kane.version}${h.kane.fake ? ' (offline stand-in)' : ''}, ${h.kane.signedIn ? 'signed in' : 'NOT signed in (run kane-cli login)'}` : 'not found'}`);
  console.log(`  OpenAI: ${h.openai ? `on (${process.env.OPENAI_MODEL}; agent ${process.env.OPENAI_FIX_MODEL})` : 'off (add OPENAI_API_KEY to .env)'}; browser: ${h.headed ? 'visible' : 'headless'}`);
  console.log(`  Apps: ${h.apps.map((a) => `${a.name} ${a.origins.join(' ')} (agent: ${a.fixAgent || 'none'}${a.fixAgent && !a.fixReady ? ', not ready' : ''})`).join('; ')}`);
});
