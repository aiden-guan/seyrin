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
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
