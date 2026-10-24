// Seyrin config, .env and binary discovery.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = resolve(ROOT, '.data');

export function loadEnv() {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

export function loadConfig() {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'seyrin.config.json'), 'utf8'));
  const server = { port: 4477, headed: true, runTimeoutSeconds: 240, maxSteps: 30, ...(raw.server || {}) };
  if (process.env.KANE_HEADLESS === '1') server.headed = false;
  const apps = (raw.apps || []).map((app) => ({
    ...app,
    repo: app.repo ? (isAbsolute(app.repo) ? app.repo : resolve(ROOT, app.repo)) : null,
    fixAgent: app.repo && process.env.FIX_AGENT ? (process.env.FIX_AGENT.startsWith('[') ? JSON.parse(process.env.FIX_AGENT) : process.env.FIX_AGENT) : app.fixAgent,
  }));
  return { server, apps, me: raw.me || {}, people: raw.people || [], teamDomains: raw.teamDomains || [], knowledge: raw.knowledge || [] };
}

/** `kane-cli`, or the offline stand-in when KANE_CLI_BIN points at it. */
export function kaneCommand(args) {
  const bin = process.env.KANE_CLI_BIN || 'kane-cli';
  return bin.endsWith('.mjs') ? [process.execPath, [resolve(ROOT, bin), ...args]] : [bin, args];
}

/** Claude Code: PATH first, then the copy bundled with the Claude desktop app. */
export function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const onPath = findOnPath('claude');
  if (onPath) return onPath;
  const base = resolve(homedir(), 'Library/Application Support/Claude/claude-code');
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).filter((name) => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    for (const build of readdirSync(resolve(base, version))) {
      const candidate = resolve(base, version, build, 'claude.app/Contents/MacOS/claude');
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {}
    }
  }
  return null;
}

export function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(':')) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
