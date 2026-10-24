/**
 * What is this email asking me to do? Seyrin recognises three kinds of request today: write a
 * document, look into a bug, change the website. Heuristics run everywhere; the server can refine
 * the extraction with OpenAI, and finalise*() re-applies the same limits to whatever comes back.
 */
import {
  INJECTION,
  SECRETS,
  cleanClause,
  detectBugReport,
  lowerFirst,
  resolveAllowedUrl,
  splitSentences,
  URL_RE,
} from './bug-report.ts';
import type { DocumentSpec, Email, SiteChangeSpec, TaskKind } from './types.ts';

export type Intent = { kind: TaskKind | null; confidence: number; ask: string; reason: string };

const DOC_NOUN = /\b(one[- ]pager|doc(?:ument)?|brief|memo|proposal|plan|outline|write[- ]?up|summary|agenda|faq|spec|report|playbook|checklist)\b/i;
const DOC_VERB = /\b(put together|write(?: up)?|draft|create|prepare|make|start|pull together|throw together|draw up|compile)\b/i;
const CHANGE_VERB = /\b(change|update|replace|set|rename|fix the (?:typo|copy|wording)|swap|switch)\b/i;
const SITE_NOUN = /\b(website|site|landing page|pricing page|home ?page|page|headline|banner|copy|price|button text)\b/i;
const ASK = /(\?|\b(can|could|would) you\b|\bplease\b|\bneed you to\b|\bmind\b)/i;

export function classifyRequest(email: Pick<Email, 'subject' | 'bodyText'> & { from?: Email['from'] }): Intent {
  const text = `${email.subject}\n${email.bodyText}`.slice(0, 8000);
  const ask = ASK.test(text);
  const changeRequest = CHANGE_VERB.test(text) && SITE_NOUN.test(text) && /\bto\b/i.test(text) && ask;
  const bug = detectBugReport({ subject: email.subject, bodyText: email.bodyText, senderEmail: email.from?.email });
  if (changeRequest && !/\b(broken|bug|nothing happens|does nothing|error)\b/i.test(text)) {
    return { kind: 'site_change', confidence: 0.8, ask: summariseAsk(email, 'site_change'), reason: 'Asks for a change to the website' };
  }
  if (bug.isBugReport) return { kind: 'bug_report', confidence: bug.confidence, ask: summariseAsk(email, 'bug_report'), reason: bug.reason };
  if (DOC_VERB.test(text) && DOC_NOUN.test(text) && ask) {
    return { kind: 'document', confidence: 0.8, ask: summariseAsk(email, 'document'), reason: 'Asks you to write a document' };
  }
  return { kind: null, confidence: 0.6, ask: '', reason: 'No task for Seyrin in this email' };
}

function summariseAsk(email: Pick<Email, 'subject' | 'bodyText'>, kind: TaskKind): string {
  if (kind === 'document') return `Write ${articled(extractDocumentHeuristic(email).title)}`;
  if (kind === 'site_change') {
    const spec = extractSiteChangeHeuristic(email, []);
    return spec.change ? upperFirst(spec.change) : 'Change the website';
  }
  return `Look into: ${email.subject.replace(/^(?:re|fwd?):\s*/i, '')}`;
}

/** "put together a one-pager for the Acme pilot. Include pricing, timeline and next steps" */
export function extractDocumentHeuristic(email: Pick<Email, 'subject' | 'bodyText'>): DocumentSpec {
  const body = email.bodyText.replace(/\r/g, '');
  const sentences = splitSentences(body).filter((s) => !INJECTION.test(s));
  let title = '';
  for (const sentence of sentences) {
    const match = /\b(?:a|an|the)\s+((?:short |quick |simple |one[- ]page )?(?:one[- ]pager|doc(?:ument)?|brief|memo|proposal|plan|outline|write[- ]?up|summary|agenda|faq|spec|report|playbook|checklist))\s+(?:for|on|about|covering)\s+(?:the |our |a |an )?([^.,;:!?\n]+?)(?=\s+(?:by|before|so|that|which|to)\b|[.,;:!?\n]|$)/i.exec(sentence);
    if (match) {
      title = `${titleCase(match[2]!.trim())} ${match[1]!.toLowerCase().replace(/^(?:short|quick|simple) /, '')}`;
      break;
    }
  }
  if (!title) title = email.subject.replace(/^(?:re|fwd?):\s*/i, '').replace(/^(?:can you|could you|please)\s+/i, '').trim() || 'Untitled document';
  const sections: string[] = [];
  for (const line of body.split('\n')) {
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.{2,80})$/.exec(line);
    if (bullet) sections.push(cleanSection(bullet[1]!));
  }
  if (!sections.length) {
    for (const sentence of sentences) {
      const match = /\b(?:include|cover|covering|with sections? (?:on|for)?|sections?:|should have|needs?)\s+(.+)$/i.exec(sentence);
      if (!match) continue;
      for (const part of match[1]!.split(/,\s*(?:and\s+)?|\s+and\s+|\s*;\s*/)) {
        const section = cleanSection(part);
        if (section.length >= 3) sections.push(section);
      }
      if (sections.length) break;
    }
  }
  const audienceMatch = /\b(?:for|to send to|to share with)\s+((?:the )?[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*(?:'s)?(?:\s+(?:team|board|investors|customers|pilot))?)/.exec(body);
  const context = sentences.filter((s) => /\d|\$|%|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(s) && !SECRETS.test(s)).map(cleanClause).slice(0, 6);
  return finaliseDocument({ title, sections, audience: audienceMatch?.[1] ?? null, context });
}

export function finaliseDocument(raw: { title?: unknown; sections?: unknown; audience?: unknown; context?: unknown }): DocumentSpec {
  const clean = (value: unknown, max = 120) => (typeof value === 'string' ? cleanClause(value).slice(0, max) : '');
  const list = (value: unknown, limit: number) =>
    (Array.isArray(value) ? value : [])
      .map((item) => clean(item))
      .filter((item) => item.length >= 2 && !SECRETS.test(item) && !INJECTION.test(item))
      .slice(0, limit);
  const sections = [...new Set(list(raw.sections, 10).map(cleanSection))];
  return {
    title: clean(raw.title, 90) || 'Untitled document',
    sections: sections.length ? sections : ['Summary', 'Details', 'Next steps'],
    audience: clean(raw.audience, 80) || null,
    context: list(raw.context, 8),
  };
}

/** "Could you change the Pro price on the pricing page to $15?" */
export function extractSiteChangeHeuristic(email: Pick<Email, 'subject' | 'bodyText'>, allowedOrigins: string[]): SiteChangeSpec {
  const text = `${email.subject}\n${email.bodyText}`;
  let url: string | null = null;
  for (const match of text.matchAll(URL_RE)) {
    url = resolveAllowedUrl(match[0], allowedOrigins);
    if (url) break;
  }
  if (!url) {
    const path = /(?:^|\s)(\/[a-z0-9][a-z0-9\-_/]*)/i.exec(text)?.[1] || (/\bpricing page\b/i.test(text) ? '/pricing' : /\b(?:home ?page|landing page)\b/i.test(text) ? '/' : /\bsign ?up page\b/i.test(text) ? '/signup' : null);
    if (path) url = resolveAllowedUrl(path, allowedOrigins);
  }
  // Greetings are kept here: "Hey, could you change …" is the whole request.
  const sentences = email.bodyText
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/^(?:hey|hi|hello)\b[^,]*,\s*/i, ''))
    .filter((s) => s && !INJECTION.test(s));
  const sentence = sentences.find((s) => CHANGE_VERB.test(s) && /\bto\b/i.test(s)) || '';
  const change = cleanClause(sentence.replace(/^(?:can|could|would) you(?: please)?\s+/i, '').replace(/\?$/, ''));
  // "the Pro price … to $15" → "the Pro plan shows $15"
  const target = /\b(?:change|update|set|replace|switch|rename)\s+(?:the\s+)?(.+?)\s+(?:on\s+(?:the\s+)?[\w\s]+?\s+)?to\s+["“']?([^"”'.?!,]+)["”']?/i.exec(sentence);
  let expected: string | null = null;
  if (target) {
    const what = target[1]!.replace(/\s+on\s+the\s+[\w\s]+page$/i, '').replace(/\bprice\b/i, 'plan').trim();
    expected = `the ${what} shows ${target[2]!.trim()}`;
  }
  return finaliseSiteChange({ url, change, expected }, allowedOrigins);
}

export function finaliseSiteChange(raw: { url?: unknown; change?: unknown; expected?: unknown }, allowedOrigins: string[]): SiteChangeSpec {
  const url = typeof raw.url === 'string' && raw.url ? resolveAllowedUrl(raw.url, allowedOrigins) : null;
  const ok = (value: unknown) => typeof value === 'string' && value.trim() && !SECRETS.test(value) && !INJECTION.test(value);
  return {
    url,
    change: ok(raw.change) ? cleanClause(String(raw.change)) : '',
    expected: ok(raw.expected) ? lowerFirst(cleanClause(String(raw.expected))) : null,
  };
}

/** Numbers, prices and dates from the request that the document must get right: where writers hallucinate. */
export function keyFacts(context: string[]): string[] {
  const facts = new Set<string>();
  const re = /\$\d[\d,.]*|\b\d+\s+(?:days?|weeks?|months?|studios?|seats?|users?)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi;
  for (const line of context) for (const match of line.matchAll(re)) facts.add(match[0].trim());
  return [...facts].slice(0, 6);
}

const listOf = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '');

/** Kane's check for a written document: every requested section, and the request's facts, on the page. */
export function compileDocumentCheck(docUrl: string, spec: DocumentSpec): string {
  const sections = listOf(spec.sections.map((s) => `"${s}"`));
  const facts = keyFacts(spec.context);
  const factCheck = facts.length ? `, and that the document states ${listOf(facts.map((f) => `"${f}"`))}` : '';
  return `Go to ${docUrl}, then verify the page shows a document titled "${spec.title}" with sections ${sections}, each with written content under it${factCheck}`;
}

export function compileSiteCheck(spec: SiteChangeSpec): string | null {
  if (!spec.url || !spec.expected) return null;
  return `Go to ${spec.url}, then verify ${spec.expected}`;
}

export function draftTaskReply(input: {
  kind: TaskKind;
  outcome: 'done' | 'failed' | 'refused' | 'needs_info';
  senderName?: string;
  link?: string | null;
  proof?: string | null;
  ask: string;
}): string {
  const hello = input.senderName ? `Hi ${input.senderName.split(/\s+/)[0]},` : 'Hi,';
  const proof = input.proof ? `\n\nI checked it end to end: ${lowerFirst(input.proof.replace(/\.$/, ''))}.` : '';
  if (input.outcome === 'done' && input.kind === 'document') {
    return `${hello}\n\nDone, here's the doc: ${input.link}${proof}\n\nLet me know what you'd change.\n`;
  }
  if (input.outcome === 'done' && input.kind === 'site_change') {
    return `${hello}\n\nDone, the change is live on ${input.link || 'the site'}.${proof}\n`;
  }
  if (input.outcome === 'refused') return `${hello}\n\nI'm not able to help with this one over email.\n`;
  if (input.outcome === 'needs_info') return `${hello}\n\nHappy to, could you tell me a bit more about what you need?\n`;
  return `${hello}\n\nI'm on it and will get back to you shortly.\n`;
}

function cleanSection(text: string): string {
  const section = cleanClause(text.replace(/^(?:a|an|the|our|some)\s+/i, '').replace(/^and\s+/i, ''));
  return section ? section[0]!.toUpperCase() + section.slice(1) : section;
}

function titleCase(text: string): string {
  return text.replace(/\b([a-z])/g, (m, c: string, i: number) => (i === 0 || !/^(?:a|an|the|of|for|and|on|in|to)\b/.test(text.slice(i)) ? c.toUpperCase() : m));
}

function upperFirst(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function articled(title: string): string {
  return `${/^[aeiou]/i.test(title) ? 'an' : 'a'} ${title}`.replace(/^an? (?=the )/i, '');
}
