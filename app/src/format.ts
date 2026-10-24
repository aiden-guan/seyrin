// Words and small formatters shared by the inbox, the Seyrin panel and the console.
import type { Decision, KaneRun, Risk, Task, TaskKind, TaskPhase, Trust } from './api.ts';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';

export const BUSY: ReadonlySet<TaskPhase> = new Set(['understanding', 'working', 'verifying']);

export const KIND_LABEL: Record<TaskKind, string> = {
  document: 'Document',
  bug_report: 'Bug report',
  site_change: 'Site change',
};

export const TRUST: Record<Trust, { label: string; tone: Tone; hint: string }> = {
  team: { label: 'Team', tone: 'good', hint: 'On your team' },
  known: { label: 'Known', tone: 'info', hint: 'Someone you know' },
  unknown: { label: 'Unknown', tone: 'warn', hint: 'Not someone Seyrin knows' },
};

export const RISK: Record<Risk, { label: string; tone: Tone; hint: string }> = {
  read: { label: 'Read-only', tone: 'neutral', hint: 'Only looks; changes nothing' },
  create: { label: 'Creates', tone: 'info', hint: 'Creates something new you can delete' },
  modify: { label: 'Changes', tone: 'warn', hint: 'Changes your code or site' },
  external: { label: 'External', tone: 'bad', hint: 'Reaches outside your company' },
};

export const DECISION: Record<Decision, { label: string; tone: Tone; hint: string }> = {
  auto: { label: 'Runs automatically', tone: 'good', hint: 'Safe to run now, and reversible' },
  approve: { label: 'Needs your approval', tone: 'warn', hint: 'Nothing runs until you approve' },
  refuse: { label: 'Refused', tone: 'bad', hint: 'Seyrin will not act on this' },
};

/** The short label on an inbox row. */
export function rowState(phase: TaskPhase): { label: string; tone: Tone; needsYou?: boolean; live?: boolean } {
  switch (phase) {
    case 'understanding':
    case 'working':
    case 'verifying':
      return { label: 'Working', tone: 'accent', live: true };
    case 'awaiting_approval':
      return { label: 'Needs you', tone: 'warn', needsYou: true };
    case 'reproduced':
      return { label: 'Bug confirmed', tone: 'warn', needsYou: true };
    case 'needs_info':
      return { label: 'Needs you', tone: 'warn', needsYou: true };
    case 'refused':
      return { label: 'Refused', tone: 'bad' };
    case 'not_reproduced':
      return { label: 'Not reproduced', tone: 'neutral' };
    case 'done':
      return { label: 'Done ✓', tone: 'good' };
    case 'failed':
      return { label: 'Failed', tone: 'bad' };
    case 'error':
      return { label: 'Error', tone: 'bad' };
    case 'dismissed':
      return { label: 'Dismissed', tone: 'neutral' };
    case 'undone':
      return { label: 'Undone', tone: 'neutral' };
  }
}

/** The headline for the panel's live status. */
export function phaseLabel(task: Task): string {
  const running = task.run && !task.run.endedAt;
  switch (task.phase) {
    case 'understanding':
      return 'Reading the email';
    case 'working':
      if (task.kind === 'bug_report') {
        if (running && !task.work) return 'Kane is reproducing the bug';
        if (running) return 'Kane is checking the fix';
        return task.work ? 'The agent is fixing it' : 'Getting ready to reproduce';
      }
      if (running) return 'Kane is checking the work';
      return task.kind === 'document' ? 'Writing the document' : 'Making the change';
    case 'verifying':
      return 'Kane is verifying in a real browser';
    case 'awaiting_approval':
      return 'Waiting for your approval';
    case 'refused':
      return 'Refused';
    case 'needs_info':
      return 'Needs more detail';
    case 'reproduced':
      return 'Bug reproduced';
    case 'not_reproduced':
      return 'Could not reproduce';
    case 'done':
      return task.result?.verified === false ? 'Done' : 'Done & verified';
    case 'failed':
      return 'Did not pass';
    case 'error':
      return 'Something went wrong';
    case 'dismissed':
      return 'Dismissed';
    case 'undone':
      return 'Undone';
  }
}

export function requesterLine(task: Task): string {
  const r = task.requester;
  const who = r.name || r.email;
  if (r.role) return `${who} · your ${r.role}`;
  if (r.trust === 'team') return `${who} · on your team`;
  if (r.trust === 'known') return `${who} · someone you know`;
  return `${who} · ${r.email}`;
}

/** "navigate: Navigate to …", "press_key: PRIMARY: press Enter | HINTS: …" → the readable part. */
export function cleanRemark(remark: string): string {
  let text = (remark || '').trim();
  if (/^step \d+$/i.test(text)) return '';
  text = text.replace(/\s*\|\s*HINTS:.*$/s, '');
  for (let i = 0; i < 3; i += 1) text = text.replace(/^(?:[a-z_]+|PRIMARY|SECONDARY|FALLBACK)\s*:\s*/i, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

export function verdictLine(run: KaneRun): { label: string; tone: Tone } | null {
  const end = run.runEnd;
  if (!end) return null;
  const severity = end.verdict?.severity;
  if (end.status === 'failed' && severity) return { label: `Confirmed ${severity} bug`, tone: 'bad' };
  if (end.status === 'passed') return { label: 'Check passed', tone: 'good' };
  if (end.status === 'failed') return { label: 'Check failed', tone: 'bad' };
  return null;
}

export function runSummary(run: KaneRun): string {
  const end = run.runEnd;
  const text = (end?.one_liner || end?.summary || end?.reason || '').trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : '';
}

export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtClock(ts: string | number | Date): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtAgo(minutes: number): string {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

export function fmtWhen(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** The fix agent's name as a button can say it: "Fix it with OpenAI". */
export function agentName(fixAgent: string | null | undefined): string {
  if (!fixAgent || fixAgent === 'custom') return 'your fix agent';
  if (fixAgent === 'openai') return 'OpenAI';
  if (fixAgent === 'claude') return 'Claude Code';
  if (fixAgent === 'codex') return 'Codex';
  if (fixAgent === 'template') return 'Seyrin Docs template';
  return fixAgent;
}

export function initials(name: string): string {
  const parts = name.replace(/["“”]/g, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase();
}
