/**
 * Seyrin: bug-report mail → a Kane CLI reproduction.
 *
 * Pure functions with no runtime imports, so the Seyrin server can load this file
 * directly with Node's type stripping. Email text is data: only the structured fields
 * below ever reach a Kane objective, and a URL is used only when it is on an origin the
 * user registered as theirs.
 */

export type BugReportInput = {
  subject: string;
  bodyText: string;
  senderEmail?: string;
};

export type BugSignal = {
  isBugReport: boolean;
  confidence: number;
  reason: string;
};

export type ReproSpec = {
  /** Absolute start URL on an allowed origin, or null when the report names none we may visit. */
  url: string | null;
  /** Short imperative steps, in order. */
  steps: string[];
  /** What should happen. This is what Kane verifies. */
  expected: string | null;
  /** What the reporter says happens instead. */
  actual: string | null;
  /** One line for the brief. */
  summary: string;
  /** Why the spec cannot be run yet, when it cannot. */
  missing: string[];
};

export type ReproVerdict = 'reproduced' | 'not_reproduced' | 'needs_info' | 'error';

/** The fields of Kane CLI's `run_end` NDJSON event this module reads. */
export type KaneRunEnd = {
  type?: string;
  status?: string;
  summary?: string;
  one_liner?: string;
  reason?: string;
  result_code?: number | string;
  reason_code?: string;
  verdict?: { confirmed?: boolean; severity?: string; category?: string; root_cause?: string } | null;
};

const BUG_WORDS =
  /\b(bug|broken|breaks?|doesn'?t work|does not work|not working|nothing happens|does nothing|won'?t (?:load|open|submit|work)|can'?t (?:click|submit|log ?in|sign ?up|check ?out|upgrade|pay)|unable to|error|crash(?:es|ed)?|stuck|frozen|blank (?:page|screen)|spinner|404|500|failed)\b/i;
const UI_WORDS = /\b(click(?:ed|ing)?|tap(?:ped)?|press(?:ed)?|button|page|form|link|submit(?:ted)?|sign ?up|checkout|log ?in|upgrade|menu|field|screen)\b/i;
const NOT_A_REPORT =
  /\b(unsubscribe|newsletter|% off|receipt|invoice|order confirmed|password reset|verify your email|security alert)\b/i;
export const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const PATH_RE = /(?:^|[\s("'`])(\/[a-z0-9][a-z0-9\-_/.]*)(?=[\s)"'`.,!?:;]|$)/gi;
const STEP_VERBS =
  'go(?:ne)? to|went to|open(?:ed)?|visit(?:ed)?|navigate(?:d)? to|click(?:ed)?|tap(?:ped)?|press(?:ed)?|select(?:ed)?|choose|chose|enter(?:ed)?|type(?:d)?|fill(?:ed)?(?: in)?|submit(?:ted)?|scroll(?:ed)?|hover(?:ed)?|add(?:ed)?|sign(?:ed)? up|log(?:ged)? in|check(?:ed)?';
const STEP_VERB = new RegExp(`^(?:then\\s+|and\\s+|i\\s+)?(${STEP_VERBS})\\b`, 'i');
const CLAUSE_SPLIT = new RegExp(`,?\\s+(?:and then|then|and)\\s+(?=(?:i\\s+)?(?:${STEP_VERBS})\\b)`, 'i');
const EXPECTED_RE =
  /\b(?:should(?:\s+have)?|expected(?:\s+(?:it\s+)?to)?|supposed to|i thought it would|it used to)\b\s*(.+)/i;
const ACTUAL_RE =
  /\b(nothing happens|does nothing|did nothing|doesn'?t (?:do|work|load|open|submit|show)[^.!?\n]*|does not [^.!?\n]+|won'?t [^.!?\n]+|never [^.!?\n]+|(?:get|got|see|saw) (?:an? )?(?:error|404|500|blank)[^.!?\n]*|is (?:broken|stuck|frozen|blank)[^.!?\n]*|just (?:spins|reloads|sits)[^.!?\n]*)/i;
export const INJECTION =
  /\b(ignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions|messages)|disregard (?:the|all|previous)|system prompt|you are now|as an ai|every link|all (?:the )?links|developer mode)\b/i;
export const SECRETS = /\b(password|passcode|otp|one[- ]time code|credit card|card number|cvv|ssn|api key|token|secret)\b/i;

// Form fields a reporter lists inline: "with name Dev Patel, email dev+x@y.com and studio Clay and Kiln".
const FIELD_LABEL =
  '(?:full |first |last |user ?)?name|e-?mail(?: address)?|studio(?: name)?|company(?: name)?|business(?: name)?|phone(?: number)?|username|website|city|zip(?: code)?|postcode|password';
const FIELD_LIST = new RegExp(`\\b(?:with|using)\\s+(?:my\\s+|the\\s+)?((?:${FIELD_LABEL})\\s+.+)$`, 'i');
const FIELD_SPLIT = new RegExp(`\\s*,\\s*(?:and\\s+)?(?:my\\s+|the\\s+)?(?=(?:${FIELD_LABEL})\\s)|\\s+and\\s+(?:my\\s+|the\\s+)?(?=(?:${FIELD_LABEL})\\s)`, 'i');
const FIELD_PAIR = new RegExp(`^(${FIELD_LABEL})\\s+(?:(?:is|of|as)\\s+)?(.+)$`, 'i');

const MAX_STEPS = 8;
const MAX_STEP_LENGTH = 160;

/** Does this inbound mail read like someone reporting a broken flow in an app? */
export function detectBugReport(input: BugReportInput): BugSignal {
  const text = `${input.subject}\n${input.bodyText}`.slice(0, 8000);
  if (NOT_A_REPORT.test(text)) {
    return { isBugReport: false, confidence: 0.8, reason: 'Transactional or marketing mail' };
  }
  const bug = BUG_WORDS.test(text);
  const ui = UI_WORDS.test(text);
  const where = URL_RE.test(text) || PATH_RE.test(text);
  URL_RE.lastIndex = 0;
  PATH_RE.lastIndex = 0;
  const subjectBug = BUG_WORDS.test(input.subject);
  if (bug && ui && where) return { isBugReport: true, confidence: 0.9, reason: 'Describes a broken action on a page' };
  if (bug && (ui || where)) return { isBugReport: true, confidence: subjectBug ? 0.8 : 0.7, reason: 'Describes something not working in the app' };
  if (subjectBug && /\b(app|site|website|dashboard|account)\b/i.test(text)) {
    return { isBugReport: true, confidence: 0.6, reason: 'Subject reports a problem with the app' };
  }
  return { isBugReport: false, confidence: 0.6, reason: 'No broken behaviour described' };
}

/**
 * Normalise an origin list such as `["https://perch.studio", "http://localhost:4480"]`.
 * Invalid entries are dropped.
 */
export function normaliseOrigins(origins: string[]): string[] {
  const out: string[] = [];
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') out.push(parsed.origin);
    } catch {
      // Not a URL; ignore.
    }
  }
  return [...new Set(out)];
}

/** The candidate as an absolute URL when it is on an allowed origin, otherwise null. */
export function resolveAllowedUrl(candidate: string, allowedOrigins: string[]): string | null {
  const origins = normaliseOrigins(allowedOrigins);
  if (!origins.length) return null;
  const trimmed = candidate.trim().replace(/[.,!?:;]+$/, '');
  try {
    const url = trimmed.startsWith('/') ? new URL(trimmed, origins[0]) : new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (!origins.includes(url.origin)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Hosts linked in the mail that are not on the allowlist, so the brief can say why Kane stayed away. */
export function foreignHosts(text: string, allowedOrigins: string[]): string[] {
  const hosts = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    if (resolveAllowedUrl(match[0], allowedOrigins)) continue;
    try {
      hosts.add(new URL(match[0]).host);
    } catch {
      // Not a URL; ignore.
    }
  }
  return [...hosts];
}

/** Deterministic extraction used when no model is configured, and to check a model's answer. */
export function extractReproHeuristic(input: BugReportInput, allowedOrigins: string[]): ReproSpec {
  const body = input.bodyText.replace(/\r/g, '');
  const url = firstAllowedUrl(`${input.subject}\n${body}`, allowedOrigins);
  const sentences = splitSentences(body);
  const steps: string[] = [];
  for (const sentence of sentences) {
    if (INJECTION.test(sentence)) continue;
    const cleaned = sentence.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim();
    for (const clause of cleaned.split(CLAUSE_SPLIT)) {
      const fills = fieldSteps(clause.trim());
      if (fills.length) steps.push(...fills);
      else if (STEP_VERB.test(clause.trim())) steps.push(imperative(clause.trim()));
    }
  }
  let expected: string | null = null;
  let actual: string | null = null;
  for (const sentence of sentences) {
    if (!expected) {
      const match = EXPECTED_RE.exec(sentence);
      if (match?.[1]) expected = match[1];
    }
    if (!actual) {
      const match = ACTUAL_RE.exec(sentence);
      if (match?.[0]) actual = match[0];
    }
  }
  return finaliseSpec({ url, steps, expected, actual, subject: input.subject }, allowedOrigins);
}

/**
 * Check and tidy a spec that came from anywhere (heuristics or a model). The URL is
 * re-checked against the allowlist, steps that carry credentials are dropped, and
 * everything is length-limited so a crafted email cannot smuggle instructions in bulk.
 */
export function finaliseSpec(
  raw: { url?: string | null; steps?: unknown; expected?: unknown; actual?: unknown; subject?: string },
  allowedOrigins: string[],
): ReproSpec {
  const url = typeof raw.url === 'string' && raw.url ? resolveAllowedUrl(raw.url, allowedOrigins) : null;
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter((step): step is string => typeof step === 'string')
    .map(cleanClause)
    .filter((step) => step.length >= 3 && !SECRETS.test(step) && !INJECTION.test(step))
    // A step may name a page on the user's own apps, never anywhere else.
    .filter((step) => [...step.matchAll(URL_RE)].every((m) => resolveAllowedUrl(m[0], allowedOrigins)))
    .filter((step) => !/^(?:go(?:ne)? to|went to|open(?:ed)?|visit(?:ed)?|navigate(?:d)? to)\s+(?:https?:\/\/\S+|\/\S*)$/i.test(step))
    .slice(0, MAX_STEPS);
  const expected = typeof raw.expected === 'string' ? outcome(cleanClause(raw.expected)) || null : null;
  const actual = typeof raw.actual === 'string' ? cleanClause(raw.actual) || null : null;
  const missing: string[] = [];
  if (!url) missing.push('a page on one of your apps');
  if (!steps.length && !expected) missing.push('what they did');
  const subject = (raw.subject || '').replace(/^(?:re|fwd?):\s*/i, '').trim();
  const summary = cleanClause(actual ? `${subject || 'Reported problem'}: ${actual}` : subject || 'Reported problem');
  const safeExpected = expected && !SECRETS.test(expected) && !INJECTION.test(expected) ? expected : null;
  return { url, steps, expected: safeExpected, actual, summary, missing };
}

/**
 * A Kane objective that passes when the app works. A failed run is the reproduction.
 * Returns null when the spec is missing something Kane needs.
 */
export function compileKaneObjective(spec: ReproSpec): string | null {
  if (!spec.url || spec.missing.length) return null;
  const parts = [`Go to ${spec.url}`, ...spec.steps.map(lowerFirst)];
  const check = spec.expected
    ? lowerFirst(spec.expected)
    : spec.actual
      ? `the problem the user reported ("${spec.actual}") does not happen`
      : 'the page responds as a user would expect';
  return `${parts.join(', then ')}, then verify ${check}`;
}

/** Map Kane's exit code and `run_end` to what the brief says. */
export function verdictFromRun(exitCode: number | null, runEnd: KaneRunEnd | null): {
  verdict: ReproVerdict;
  detail: string;
} {
  // Kane's `reason` is often about the agent ("no viable actions remain"); the verdict and one-liner describe the app.
  const detail = runEnd?.verdict?.root_cause || runEnd?.one_liner || runEnd?.summary?.split('\n')[0] || runEnd?.reason || '';
  if (exitCode === 2 || (!runEnd && exitCode !== 0)) {
    return { verdict: 'error', detail: detail || 'Kane CLI did not start the run.' };
  }
  // Exit 0 with no run_end is a stream that ended early: there is no result to call a pass.
  if (!runEnd) return { verdict: 'error', detail: 'Kane CLI exited without reporting a result.' };
  if (exitCode === 3) return { verdict: 'error', detail: detail || 'The run timed out or was canceled.' };
  if (String(runEnd?.result_code ?? '') === '740') {
    const severity = runEnd?.verdict?.severity ? `${runEnd.verdict.severity} ` : '';
    return { verdict: 'reproduced', detail: `Kane confirmed a ${severity}product bug. ${detail}`.trim() };
  }
  if (runEnd?.status === 'passed' || exitCode === 0) {
    return { verdict: 'not_reproduced', detail: detail || 'The flow worked as expected.' };
  }
  if (runEnd?.status === 'failed') return { verdict: 'reproduced', detail: detail || 'The expected result did not happen.' };
  return { verdict: 'error', detail: detail || 'Kane CLI ended without a result.' };
}

/** A reply the user can edit before sending. Never sent automatically. */
export function draftReproReply(input: {
  verdict: ReproVerdict | 'fixed';
  spec: ReproSpec;
  senderName?: string;
}): string {
  const hello = input.senderName ? `Hi ${input.senderName.split(/\s+/)[0]},` : 'Hi,';
  const what = input.spec.actual ? lowerFirst(input.spec.actual) : 'the problem you described';
  switch (input.verdict) {
    case 'reproduced':
      return `${hello}\n\nThanks for the report. I was able to reproduce it: ${what}. I'm on it and will let you know as soon as it's fixed.\n`;
    case 'fixed':
      return `${hello}\n\nThanks again for reporting this. It's fixed now, and I've checked the same steps end to end. Let me know if you see anything else.\n`;
    case 'not_reproduced':
      return `${hello}\n\nThanks for the report. I followed the same steps and it worked for me, so it may depend on your setup. Which browser and device are you using, and does it still happen if you refresh?\n`;
    case 'needs_info':
      return `${hello}\n\nThanks for the report. Could you tell me which page you were on and what you clicked just before it happened? A screenshot would help too.\n`;
    default:
      return `${hello}\n\nThanks for the report. I'm looking into it and will get back to you shortly.\n`;
  }
}

function firstAllowedUrl(text: string, allowedOrigins: string[]): string | null {
  for (const match of text.matchAll(URL_RE)) {
    const url = resolveAllowedUrl(match[0], allowedOrigins);
    if (url) return url;
  }
  for (const match of text.matchAll(PATH_RE)) {
    const url = match[1] ? resolveAllowedUrl(match[1], allowedOrigins) : null;
    if (url) return url;
  }
  return null;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^(?:hi|hello|hey|thanks|thank you|cheers|best|regards)\b/i.test(part));
}

export function cleanClause(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/["`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:\s]+$/, '')
    .trim()
    .slice(0, MAX_STEP_LENGTH);
}

const PAST_TO_IMPERATIVE: Record<string, string> = {
  went: 'go', gone: 'go', clicked: 'click', tapped: 'tap', pressed: 'press', selected: 'select', chose: 'choose',
  entered: 'enter', typed: 'type', filled: 'fill', submitted: 'submit', scrolled: 'scroll', hovered: 'hover',
  added: 'add', signed: 'sign', logged: 'log', checked: 'check', opened: 'open', visited: 'visit', navigated: 'navigate',
};

/**
 * "…sign up at /signup with name Dev Patel, email dev+x@y.com and studio Clay and Kiln"
 * → ["Enter name 'Dev Patel'", "Enter email 'dev+x@y.com'", "Enter studio 'Clay and Kiln'"].
 * The exact values matter: in a bug report they are often what triggers the bug.
 */
function fieldSteps(clause: string): string[] {
  const list = FIELD_LIST.exec(clause)?.[1];
  if (!list) return [];
  const steps: string[] = [];
  for (const part of list.split(FIELD_SPLIT)) {
    const pair = FIELD_PAIR.exec(part.trim());
    const value = pair?.[2]?.trim().replace(/^['"]|['"]$/g, '').replace(/[.,!?;:]+$/, '');
    if (!pair?.[1] || !value || value.length > 80) continue;
    steps.push(`Enter ${pair[1].toLowerCase()} '${value}'`);
  }
  return steps;
}

/** "I clicked Upgrade" → "Click Upgrade". */
function imperative(clause: string): string {
  const bare = clause.replace(/^(?:then|and)\s+/i, '').replace(/^i\s+/i, '');
  const [first = '', ...rest] = bare.split(/\s+/);
  const verb = PAST_TO_IMPERATIVE[first.toLowerCase()] || first.toLowerCase();
  return [verb[0]!.toUpperCase() + verb.slice(1), ...rest].join(' ');
}

/** "to see the checkout form" → "the page shows the checkout form"; "created my account" → "the account is created". */
function outcome(text: string): string {
  const bare = text.replace(/^(?:to|it to|it would|it'd)\s+/i, '').replace(/^(?:have|has)\s+/i, '');
  const shown = /^(?:see|get|be shown|be taken to|land on|reach)\s+(.+)$/i.exec(bare);
  if (shown?.[1]) return `the page shows ${shown[1]}`;
  const done = /^(\w+ed|shown|sent|done)\s+(?:my|the|a|an|our)\s+(.+)$/i.exec(bare);
  if (done?.[1] && done[2]) return `the ${done[2]} is ${done[1].toLowerCase()}`;
  return bare;
}

export function lowerFirst(text: string): string {
  return text.length > 1 && /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}
