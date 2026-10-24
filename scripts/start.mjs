#!/usr/bin/env node
// One command for the demo: Perch on :4480, the Kane bridge (and the inbox) on :4477.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
const run = (label, args, env = {}) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) console.log(`[${label}] ${line}`);
    });
  }
  child.on('exit', (code) => code && console.log(`[${label}] exited with ${code}`));
  children.push(child);
  return child;
};

if (!existsSync(resolve(root, 'inbox/dist/index.html'))) {
  console.log('[inbox] building from the PigeonBox extension source…');
  await new Promise((done) => run('inbox', ['inbox/build.mjs'], { INBOX_MINIFY: '0' }).on('exit', done));
}
run('perch', ['demo-app/server.mjs']);
run('bridge', ['bridge/server.mjs']);
setTimeout(() => console.log('\nOpen the support inbox: http://127.0.0.1:4477\nPerch (the app customers write about): http://localhost:4480\n'), 1200);
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
