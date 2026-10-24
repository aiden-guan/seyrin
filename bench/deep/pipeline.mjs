// The path an email takes in Seyrin before any agent or Kane run, using the server's own modules:
// classifyRequest → trustOf → decide → extractSpec (heuristics; OpenAI only if a key is set) → the
// Kane objective, and missingFor's "needs info" check. Mirrors create(), understand() and start() in
// server/tasks.mjs, minus the side effects.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const core = await import(resolve(ROOT, 'core/index.ts'));
const { extractSpec } = await import(resolve(ROOT, 'server/extract.mjs'));
export const config = JSON.parse(readFileSync(resolve(ROOT, 'seyrin.config.json'), 'utf8'));
export const origins = config.apps.flatMap((app) => app.origins);
const policy = { people: config.people, teamDomains: config.teamDomains };
const DOC_URL = 'http://127.0.0.1:4477/d/bench';

export async function pipeline(mail) {
  const email = { threadId: mail.id, subject: mail.subject, from: mail.from, bodyText: mail.body };
  const intent = core.classifyRequest(email);
  if (!intent.kind) return { kind: null, outcome: 'none', reason: intent.reason };
  const trust = core.trustOf(email.from, policy);
  const decision = core.decide({ kind: intent.kind, trust, email, allowedOrigins: origins });
  const out = { kind: intent.kind, trust: trust.trust, decision: decision.decision, reasons: decision.reasons };
  if (decision.decision === 'refuse') return { ...out, outcome: 'refuse' };
  const { spec, extractor } = await extractSpec({ kind: intent.kind, email, origins, core });
  out.spec = spec;
  out.extractor = extractor;
  out.objective =
    intent.kind === 'document' ? core.compileDocumentCheck(DOC_URL, spec) : intent.kind === 'site_change' ? core.compileSiteCheck(spec) : core.compileKaneObjective(spec);
  // missingFor(): a bug report or site change with no allowed page, or nothing to check, stops here.
  if (intent.kind !== 'document' && (!spec.url || !out.objective)) return { ...out, outcome: 'needs_info' };
  return { ...out, outcome: decision.decision === 'auto' ? 'runs' : 'hold' };
}
