/**
 * Who may ask Seyrin for what. Every task passes through decide() before anything runs, and the
 * reasons are shown to the user next to the plan, so a decision is never silent.
 */
import { INJECTION, SECRETS, URL_RE } from './bug-report.ts';
import type { Decision, Email, Person, Risk, TaskKind, Trust } from './types.ts';

export type TrustPolicy = {
  people: Person[];
  /** Everyone at these domains is on the team, e.g. ["perch.studio"]. */
  teamDomains: string[];
};

/** Money, credentials and data leaving the company: never handled by an agent, whoever asks. */
export const SENSITIVE =
  /\b(wire|bank (?:details|account|transfer)|routing number|iban|swift|gift ?cards?|crypto|bitcoin|payroll|pay (?:this|the) invoice|send (?:me )?(?:the )?(?:money|payment)|password|passcode|credentials|2fa|one[- ]time code|ssn|social security|w-?2|tax form)\b/i;

export type TrustResult = { trust: Trust; person: Person | null; reasons: string[] };

export function trustOf(from: Email['from'], policy: TrustPolicy): TrustResult {
  const email = from.email.trim().toLowerCase();
  const domain = email.split('@')[1] || '';
  const person = policy.people.find((p) => p.email.toLowerCase() === email) || null;
  // A display name that belongs to someone we trust, on an address that isn't theirs, is the classic spoof.
  const namesake = from.name
    ? policy.people.find((p) => p.trust === 'team' && p.name && p.name.toLowerCase() === from.name!.trim().toLowerCase() && p.email.toLowerCase() !== email)
    : null;
  if (namesake) {
    return { trust: 'unknown', person: null, reasons: [`Uses ${namesake.name}'s name from ${email}, which is not their address`] };
  }
  if (person) return { trust: person.trust, person, reasons: [`${person.name || person.email} is ${person.role ? `your ${person.role}` : person.trust === 'team' ? 'on your team' : 'someone you know'}`] };
  if (policy.teamDomains.map((d) => d.toLowerCase()).includes(domain)) {
    return { trust: 'team', person: { email, name: from.name, trust: 'team' }, reasons: [`${domain} is your team's domain`] };
  }
  return { trust: 'unknown', person: null, reasons: [`${email} is not someone Seyrin knows`] };
}

/** What doing the task changes. Fixing a bug changes code, so it is assessed separately from reproducing it. */
export function riskOf(kind: TaskKind, stage: 'run' | 'fix' = 'run'): Risk {
  if (kind === 'bug_report') return stage === 'fix' ? 'modify' : 'read';
  if (kind === 'document') return 'create';
  return 'modify';
}

export function decide(input: {
  kind: TaskKind;
  stage?: 'run' | 'fix';
  trust: TrustResult;
  email: Email;
  /** Origins the user registered as theirs. */
  allowedOrigins: string[];
}): { decision: Decision; risk: Risk; reasons: string[] } {
  const risk = riskOf(input.kind, input.stage);
  const text = `${input.email.subject}\n${input.email.bodyText}`;
  const reasons = [...input.trust.reasons];
  const injected = INJECTION.test(text);
  const foreign = [...text.matchAll(URL_RE)].map((m) => m[0]).filter((url) => !input.allowedOrigins.some((o) => safeOrigin(url) === safeOrigin(o)));

  if (SENSITIVE.test(text) || SECRETS.test(text)) {
    return { decision: 'refuse', risk, reasons: [...reasons, 'Mentions money, credentials or personal data. Seyrin never acts on that; handle it yourself.'] };
  }
  if (input.trust.trust === 'unknown' && input.trust.reasons.some((r) => /not their address/.test(r))) {
    return { decision: 'refuse', risk, reasons: [...reasons, 'Looks like impersonation, so Seyrin will not act on it.'] };
  }
  if (injected) reasons.push('Contains instructions aimed at an AI. Seyrin ignores them and asks you first.');
  if (foreign.length) reasons.push(`Links to ${[...new Set(foreign.map(safeHost))].join(', ')}, which Seyrin will not open.`);

  if (input.kind === 'site_change' && input.trust.trust !== 'team') {
    return { decision: 'refuse', risk, reasons: [...reasons, 'Only your team can ask for changes to your site.'] };
  }
  if (injected) return { decision: 'approve', risk, reasons };
  if (risk === 'read') return { decision: 'auto', risk, reasons: [...reasons, 'Read-only: Kane only looks at your own app.'] };
  if (risk === 'create' && input.trust.trust === 'team') {
    return { decision: 'auto', risk, reasons: [...reasons, 'Creates a private document you can delete. Nothing is shared or sent.'] };
  }
  if (risk === 'create') return { decision: 'approve', risk, reasons: [...reasons, 'Creates a document for someone outside your team: approve first.'] };
  return { decision: 'approve', risk, reasons: [...reasons, 'Changes your code or site: approve first. Every change can be undone.'] };
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
