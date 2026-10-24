#!/usr/bin/env node
// One command for the demo: Perch on :4480, Seyrin (server + inbox app) on :4477.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
const run = (label, cmd, args, env = {}) => {
  const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) console.log(`[${label}] ${line}`);
    });
  }
  child.on('exit', (code) => code && console.log(`[${label}] exited with ${code}`));
  children.push(child);
  return child;
};

if (!existsSync(resolve(root, 'app/dist/index.html'))) {
  console.log('[app] building the inbox…');
  await new Promise((done) => run('app', 'npx', ['vite', 'build', 'app']).on('exit', done));
}
run('perch', process.execPath, ['demo-app/server.mjs']);
run('seyrin', process.execPath, ['server/server.mjs']);
setTimeout(() => console.log('\nSeyrin inbox: http://127.0.0.1:4477\nSeyrin Docs:  http://127.0.0.1:4477/d\nPerch (the demo product): http://localhost:4480\n'), 1500);

// Every start stages the demo: reset (planted bugs back, tasks and docs cleared), then pre-run the inbox
// with real Kane, leaving Approve and Fix it for the live demo. Skip with --no-prepare or SEYRIN_PREPARE=0.
if (!process.argv.includes('--no-prepare') && process.env.SEYRIN_PREPARE !== '0') prepareDemo();

async function prepareDemo() {
  const port = process.env.SEYRIN_PORT || '4477';
  const seyrin = `http://127.0.0.1:${port}`;
  const up = async (url) => {
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(url);
        if (res.ok) return res;
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  };
  const [health, perch] = await Promise.all([up(`${seyrin}/health`), up('http://localhost:4480/')]);
  if (!health || !perch) return console.log('[prepare] skipped: Seyrin or Perch did not come up within 30 s.');
  const { kane } = await health.json();
  if (!kane?.installed || !kane?.signedIn) return console.log('[prepare] skipped: Kane CLI is not installed or not signed in (kane-cli login).');
  console.log('[prepare] staging the demo: reset, then Kane runs each demo email (a few minutes with real Kane)…');
  run('prepare', process.execPath, ['bench/scenario.mjs', '--prepare'], { SEYRIN_URL: seyrin }).on('exit', (code) =>
    console.log(code ? `[prepare] stopped with exit code ${code}; run npm run demo:prepare to retry.` : `[prepare] demo ready: ${seyrin}`),
  );
}
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
