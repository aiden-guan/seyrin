#!/usr/bin/env node
// Time a manual baseline: node bench/stopwatch.mjs "Fix the Upgrade bug by hand"
// Press Enter to start, Enter again to stop. Appends to bench/manual.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const label = process.argv.slice(2).join(' ') || 'manual task';
const file = fileURLToPath(new URL('./manual.json', import.meta.url));
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((done) => rl.question(q, done));
await ask(`"${label}": press Enter to START the clock… `);
const start = Date.now();
await ask('Working. Press Enter to STOP… ');
const seconds = Math.round((Date.now() - start) / 1000);
rl.close();
const runs = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
runs.push({ label, seconds, at: new Date().toISOString() });
writeFileSync(file, JSON.stringify(runs, null, 2) + '\n');
console.log(`${label}: ${seconds}s (saved to bench/manual.json)`);
