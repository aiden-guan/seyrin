// The Kane console: every Kane CLI line, agent log line and gate event, live from /v1/events.
import { useEffect, useRef, useState } from 'react';
import { api, onEvent } from './api.ts';
import { cleanRemark, fmtClock } from './format.ts';
import { ChevronIcon, TerminalIcon } from './icons.tsx';

type Line = { id: number; at: string; source: string; label?: string; text: string; tone?: 'good' | 'bad' | 'dim' };
const MAX_LINES = 400;

export function KaneConsole({ open, onToggle, subjectFor }: { open: boolean; onToggle: () => void; subjectFor: (taskId: string) => string | null }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [live, setLive] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const counter = useRef(0);
  const subjectRef = useRef(subjectFor);
  subjectRef.current = subjectFor;
  const backfilled = useRef(false);

  useEffect(() => {
    const push = (line: Omit<Line, 'id' | 'at'> & { at?: string }) => {
      counter.current += 1;
      const next: Line = { ...line, id: counter.current, at: fmtClock(line.at || Date.now()) };
      setLines((prev) => (prev.length >= MAX_LINES ? [...prev.slice(prev.length - MAX_LINES + 1), next] : [...prev, next]));
    };
    const offs = [
      onEvent('open', () => {
        setLive(true);
        if (backfilled.current) return;
        backfilled.current = true;
        // After a reload, show what Seyrin already logged so the console isn't blank mid-demo.
        api
          .tasks()
          .then(({ tasks }) => {
            const history = tasks
              .flatMap((t) => (t.log || []).map((entry) => ({ entry, subject: t.email?.subject || '' })))
              .sort((a, b) => Date.parse(a.entry.ts) - Date.parse(b.entry.ts))
              .slice(-80)
              .map(({ entry, subject }) => {
                counter.current += 1;
                return { id: counter.current, at: fmtClock(entry.ts), source: entry.source, label: short(subject), text: entry.text, tone: 'dim' as const };
              });
            if (history.length) setLines((prev) => [...history.filter((h) => !prev.some((p) => p.at === h.at && p.text === h.text)), ...prev].slice(-MAX_LINES));
          })
          .catch(() => {});
      }),
      onEvent('down', () => setLive(false)),
      onEvent('reset', () => {
        setLines([]);
        push({ source: 'seyrin', text: 'Demo reset: tasks, documents and planted bugs are back to the start.', tone: 'dim' });
      }),
      onEvent('kane', (data: { id?: string; line?: Record<string, unknown>; label?: string }) => {
        if (!data?.line) return;
        const described = describeKane(data.line, data.label);
        if (described) push({ ...described, at: typeof data.line.ts === 'string' ? data.line.ts : undefined });
      }),
      onEvent('log', (data: { id?: string; ts?: string; source?: string; text?: string }) => {
        if (!data?.text) return;
        // Kane errors and warnings also arrive as typed Kane lines.
        if (data.source === 'kane' && /^(error|warning):/i.test(data.text)) return;
        const subject = data.id ? subjectRef.current(data.id) : null;
        push({ source: data.source || 'seyrin', label: subject ? short(subject) : undefined, text: data.text, at: data.ts });
      }),
      onEvent('gate', (data: Record<string, unknown>) => {
        const described = describeGate(data);
        if (described) push({ source: 'gate', ...described, at: typeof data.ts === 'string' ? data.ts : undefined });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Follow the bottom unless the reader scrolled up. (Block body: scrollIntoView can return a Promise.)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open) return;
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  const last = lines.at(-1);

  return (
    <section className={`console${open ? ' is-open' : ''}`} aria-label="Kane console">
      <button type="button" className="console-head" onClick={onToggle} aria-expanded={open} aria-controls="kane-console-body">
        <TerminalIcon />
        <span className="console-title">Kane console</span>
        {live ? null : <span className="console-live">offline</span>}
        <span className="console-peek">{open ? (lines.length ? `${lines.length} lines` : '') : last ? `${last.at}  ${last.source}  ${last.text}` : 'Waiting for Kane…'}</span>
        <span className="console-toggle">
          <ChevronIcon className={open ? 'rot-90' : 'rot--90'} />
        </span>
      </button>
      {open ? (
        <div
          id="kane-console-body"
          className="console-body"
          ref={bodyRef}
          role="log"
          aria-live="off"
          tabIndex={0}
          onScroll={(event) => {
            const el = event.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {lines.length ? null : <p className="console-empty">Waiting for Kane…</p>}
          {lines.map((line) => (
            <div key={line.id} className={`cline cs-${line.source}${line.tone ? ` is-${line.tone}` : ''}`}>
              <span className="cline-at">{line.at}</span>
              <span className="cline-src">{line.source}</span>
              <span className="cline-text">
                {line.label ? <span className="cline-label">{line.label}</span> : null}
                {line.text}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function short(subject: string): string | undefined {
  if (!subject) return undefined;
  return subject.length > 26 ? `${subject.slice(0, 25).trimEnd()}…` : subject;
}

function describeKane(line: Record<string, unknown>, label?: string): Omit<Line, 'id' | 'at'> | null {
  const type = typeof line.type === 'string' ? line.type : null;
  const base = { source: 'kane', label: label || undefined };
  if (type === 'stream_start') return { ...base, text: `stream_start · kane-cli ${line.cli_version ?? ''}${line.surface ? ` (${line.surface})` : ''}`, tone: 'dim' };
  if (type === 'run_end') {
    const why = (line.one_liner || line.reason || line.summary || '') as string;
    const verdict = (line.verdict as { severity?: string } | undefined)?.severity;
    return {
      ...base,
      text: `run_end ${line.status}${verdict ? ` · ${verdict}` : ''}${typeof line.duration === 'number' ? ` · ${Math.round(line.duration)}s` : ''}${why ? ` · ${why}` : ''}`,
      tone: line.status === 'passed' ? 'good' : 'bad',
    };
  }
  if (type === 'error' || type === 'warning') return { ...base, text: `${type}: ${line.message ?? ''}`, tone: type === 'error' ? 'bad' : undefined };
  if (type === 'recording_state' || type === 'skill_update_available') return null;
  if (type === 'bifurcation') return { ...base, text: `planning ${line.count ?? ''} flow${line.count === 1 ? '' : 's'}`, tone: 'dim' };
  if (type) return { ...base, text: `${type}${line.message ? `: ${line.message}` : ''}`, tone: 'dim' };
  if (typeof line.step === 'number') {
    const status = String(line.status || '');
    const text = cleanRemark(String(line.remark || ''));
    const mark = status === 'done' ? '✓' : status === 'failed' ? '✕' : '•';
    return { ...base, text: `${mark} step ${line.step}${text ? `  ${text}` : status === 'running' ? '  …' : ''}`, tone: status === 'failed' ? 'bad' : status === 'running' ? 'dim' : undefined };
  }
  return { ...base, text: JSON.stringify(line).slice(0, 220), tone: 'dim' };
}

function describeGate(entry: Record<string, unknown>): { text: string; tone?: Line['tone']; label?: string } | null {
  const kind = entry.kind;
  if (kind === 'gate_start') return { text: `gate started${entry.mode ? ` (${entry.mode})` : ''}${entry.flows ? ` · ${Array.isArray(entry.flows) ? entry.flows.length : entry.flows} flows` : ''}` };
  if (kind === 'flow_end') {
    return {
      label: typeof entry.flow === 'string' ? entry.flow : undefined,
      text: `flow ${entry.status}${entry.reason ? ` · ${entry.reason}` : ''}`,
      tone: entry.status === 'passed' ? 'good' : entry.status === 'skipped' ? 'dim' : 'bad',
    };
  }
  if (kind === 'gate_end') {
    const failed = Number(entry.failed || 0);
    return {
      text: `gate ${entry.decision || (failed ? 'failed' : 'passed')} · ${entry.passed ?? 0} passed, ${failed} failed${entry.reason ? ` · ${entry.reason}` : ''}`,
      tone: entry.decision === 'skip' ? 'dim' : failed || entry.decision === 'block' || entry.decision === 'error' ? 'bad' : 'good',
    };
  }
  if (kind === 'agent_start') return { text: `fix agent ${entry.agent ?? ''} started (round ${entry.round ?? 1})` };
  if (kind === 'agent_end') return { text: `fix agent finished (exit ${entry.exit_code ?? '?'})`, tone: 'dim' };
  if (kind === 'gate_error') return { text: `gate error: ${String(entry.error || '').split('\n')[0]}`, tone: 'bad' };
  return null;
}
