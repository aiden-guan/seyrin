// The Seyrin panel: what was asked, the safeguards that decided what happens, the plan, live
// progress from the agent and Kane, the verified result, and the reply. One panel per email.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, isTask, shotUrl, type Health, type KaneRun, type LogEntry, type OutgoingEmail, type Policy, type Task, type WorkAttempt } from './api.ts';
import { AsciiField } from './ascii.tsx';
import {
  BUSY,
  DECISION,
  KIND_LABEL,
  RISK,
  TRUST,
  agentName,
  cleanRemark,
  fmtClock,
  fmtElapsed,
  phaseLabel,
  requesterLine,
  runSummary,
  verdictLine,
  type Tone,
} from './format.ts';
import {
  AlertIcon,
  ArrowOutIcon,
  BugIcon,
  CheckIcon,
  ChevronIcon,
  CrossIcon,
  DecisionIcon,
  HandIcon,
  ImageIcon,
  KaneIcon,
  KindIcon,
  LeafIcon,
  PencilIcon,
  PersonIcon,
  ReplyIcon,
  RetryIcon,
  RiskIcon,
  SealIcon,
  SeyrinMark,
  ShieldIcon,
  ShieldOffIcon,
  SparkIcon,
  ToolIcon,
  UndoIcon,
} from './icons.tsx';

type Load = { status: 'opening' } | { status: 'notask'; reason: string } | { status: 'offline'; message: string } | { status: 'task' };

type Props = {
  email: OutgoingEmail;
  health: Health | null;
  onTask: (task: Task) => void;
  onUseReply: (text: string) => void;
};

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [active, every]);
  return now;
}

/** When the current stretch of work began, for a panel opened in the middle of it. */
function initialBusyStart(task: Task): number {
  let start = Date.parse(task.createdAt) || Date.now();
  for (const run of task.runs || []) {
    const ended = run.endedAt ? Date.parse(run.endedAt) : 0;
    if (ended > start) start = ended;
  }
  if (task.run && !task.run.endedAt) start = Math.min(start, Date.parse(task.run.startedAt) || start);
  return start;
}

export function SeyrinPanel({ email, health, onTask, onUseReply }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'opening' });
  const [task, setTask] = useState<Task | null>(null);
  const [opening, setOpening] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const emailRef = useRef(email);
  emailRef.current = email;
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardInView, setCardInView] = useState(true);

  // Hand the email to Seyrin. The server is idempotent per thread, so reopening is cheap.
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'opening' });
    api
      .open(emailRef.current)
      .then((next) => {
        if (cancelled) return;
        setTask(next);
        setLoad({ status: 'task' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404 && error.body?.error === 'no_task') {
          setLoad({ status: 'notask', reason: typeof error.body.reason === 'string' ? error.body.reason : '' });
        } else {
          setLoad({ status: 'offline', message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [email.threadId, opening]);

  // Follow the task live.
  const taskId = task?.id;
  useEffect(() => {
    if (!taskId) return;
    const source = new EventSource(`/v1/tasks/${encodeURIComponent(taskId)}/stream`);
    source.addEventListener('state', (event) => {
      try {
        const next = JSON.parse((event as MessageEvent).data);
        if (isTask(next) && next.id === taskId) setTask(next);
      } catch {}
    });
    source.addEventListener('log', (event) => {
      try {
        const entry = JSON.parse((event as MessageEvent).data) as LogEntry;
        setTask((prev) => {
          if (!prev || prev.id !== taskId) return prev;
          if (prev.log.some((e) => e.ts === entry.ts && e.text === entry.text)) return prev;
          return { ...prev, log: [...prev.log, entry].slice(-400) };
        });
      } catch {}
    });
    return () => source.close();
  }, [taskId]);

  useEffect(() => {
    if (task) onTask(task);
  }, [task, onTask]);

  // When the progress, action or result card is scrolled out of view, a slim bar keeps it at hand.
  const hasTask = load.status === 'task' && Boolean(task);
  useEffect(() => {
    const el = cardRef.current;
    if (!hasTask || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setCardInView(Boolean(entry?.isIntersecting)), { rootMargin: '0px 0px -64px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasTask, taskId]);

  // When the phase changes while the panel is open (Kane finished, a fix started, an approval is needed),
  // bring the card with the result or the next action into view. Opening an email keeps the top in view.
  const shownPhase = useRef<string | null>(null);
  useEffect(() => {
    if (!task) return;
    const prev = shownPhase.current;
    shownPhase.current = `${task.id}:${task.phase}`;
    if (!prev || !prev.startsWith(`${task.id}:`) || prev === shownPhase.current) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [task?.id, task?.phase]);

  // Elapsed time for the current stretch of work.
  const busy = task ? BUSY.has(task.phase) : false;
  const [busySince, setBusySince] = useState<number | null>(null);
  const sawIdle = useRef(false);
  useEffect(() => {
    if (!task) return;
    if (BUSY.has(task.phase)) setBusySince((prev) => prev ?? (sawIdle.current ? Date.now() : initialBusyStart(task)));
    else {
      sawIdle.current = true;
      setBusySince(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.phase, task?.id]);
  const now = useNow(busy);

  const act = async (name: string, run: () => Promise<Task>) => {
    setPending(name);
    setActionError(null);
    try {
      const next = await run();
      if (isTask(next)) setTask(next);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  };

  const openEvidence = async (run: KaneRun) => {
    if (!task) return;
    // Open the tab inside the click so the browser doesn't block it, then point it at the viewer.
    const win = window.open('', '_blank');
    try {
      win?.document.write(
        '<title>Kane evidence</title><body style="margin:0;background:#f7f7f5;color:#45454d;font:14px/1.6 system-ui,sans-serif;padding:40px"><p id="m">Starting Kane’s evidence viewer…</p></body>',
      );
    } catch {}
    try {
      const { viewer } = await api.evidence(task.id, run.attempt);
      if (win) win.location.href = viewer;
      else window.open(viewer, '_blank', 'noopener');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Say why in the tab itself; the panel's error line is often scrolled out of view.
      const line = win?.document.getElementById('m');
      if (line) line.textContent = message;
      else win?.close();
      setActionError(message);
    }
  };

  if (load.status === 'opening' && !task) return <PanelFrame><Opening /></PanelFrame>;
  if (load.status === 'notask') {
    return (
      <PanelFrame>
        <div className="sp-empty">
          <span className="sp-empty-icon">
            <LeafIcon size={20} />
          </span>
          <h2>Nothing to do here</h2>
          <p>{load.reason && !/^no task/i.test(load.reason) ? load.reason : 'No doc, bug or site change asked for. This one stays with you.'}</p>
        </div>
      </PanelFrame>
    );
  }
  if (load.status === 'offline' || !task) {
    return (
      <PanelFrame>
        <div className="sp-empty is-offline">
          <span className="sp-empty-icon">
            <AlertIcon size={20} />
          </span>
          <h2>Seyrin isn&rsquo;t reachable</h2>
          <p>{load.status === 'offline' ? load.message : 'Waiting for the server.'}</p>
          <button type="button" className="btn btn-quiet" onClick={() => setOpening((n) => n + 1)}>
            <RetryIcon /> Try again
          </button>
        </div>
      </PanelFrame>
    );
  }

  const latestEnded = [...(task.runs || [])].reverse().find((r) => r.endedAt || r.runEnd) || null;
  const liveRun = task.run && !task.run.endedAt && !task.run.runEnd ? task.run : null;
  const healthApp = health?.apps.find((a) => a.id === task.app?.id) || null;

  return (
    <PanelFrame task={task} busy={busy} elapsed={busy && busySince ? now - busySince : null}>
      <section className="sp-ask" aria-label="What was asked">
        <h2 className="ask">{task.ask}</h2>
        <p className="ask-from">
          from <strong>{requesterLine(task).split(' · ')[0]}</strong>
          <span> · {requesterLine(task).split(' · ').slice(1).join(' · ')}</span>
        </p>
      </section>

      <Safeguards policy={task.policy} trust={task.requester.trust} />

      {actionError ? (
        <p className="sp-error" role="alert">
          <AlertIcon /> {actionError}
        </p>
      ) : null}

      <div ref={cardRef} className="card-anchor">
      <StateCard
        key={task.phase}
        task={task}
        now={now}
        busySince={busySince}
        liveRun={liveRun}
        pending={pending}
        fixReady={healthApp ? healthApp.fixReady : true}
        fixAgent={task.work?.agent || healthApp?.fixAgent || null}
        onApprove={() => act('approve', () => api.approve(task.id))}
        onDismiss={() => act('dismiss', () => api.dismiss(task.id))}
        onFix={() => act('fix', () => api.fix(task.id))}
        onUndo={() => act('undo', () => api.undo(task.id))}
        onRetry={() => act('retry', () => api.open(emailRef.current, true))}
        onEditSpec={(spec) => act('edit', () => api.editSpec(task.id, spec))}
      />
      </div>

      <PlanSection task={task} liveRun={liveRun} />

      {latestEnded ? <Evidence task={task} run={latestEnded} busy={busy} onOpen={openEvidence} /> : null}

      {task.work?.attempts?.length ? <Attempts attempts={task.work.attempts} agent={task.work.agent} kind={task.kind} /> : null}

      {task.draftReply && !busy && task.phase !== 'awaiting_approval' && task.phase !== 'dismissed' ? (
        <section className="sp-section" aria-labelledby={`reply-${task.id}`}>
          <h3 className="sp-h" id={`reply-${task.id}`}>
            <ReplyIcon /> Draft reply
          </h3>
          <div className="draft">{task.draftReply}</div>
          <div className="row">
            <button type="button" className="btn btn-quiet" onClick={() => onUseReply(task.draftReply)}>
              <ReplyIcon /> Use this reply
            </button>
            <span className="fine">You review and send.</span>
          </div>
        </section>
      ) : null}

      <Audit log={task.log} extractor={task.extractor} />
      {cardInView ? null : (
        <ActionBar
          task={task}
          liveRun={liveRun}
          elapsed={busy && busySince ? now - busySince : null}
          pending={pending}
          fixReady={healthApp ? healthApp.fixReady : true}
          fixAgent={task.work?.agent || healthApp?.fixAgent || null}
          onApprove={() => act('approve', () => api.approve(task.id))}
          onFix={() => act('fix', () => api.fix(task.id))}
          onRetry={() => act('retry', () => api.open(emailRef.current, true))}
          onJump={() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        />
      )}
    </PanelFrame>
  );
}

// ---------------------------------------------------------------------------------------------

function PanelFrame({ task, busy, elapsed, children }: { task?: Task; busy?: boolean; elapsed?: number | null; children: ReactNode }) {
  return (
    <div className="sp">
      <header className="sp-head">
        <SeyrinMark size={20} />
        <span className="sp-title">Seyrin</span>
        {task ? <span className="sp-kind">{KIND_LABEL[task.kind] || task.kind}</span> : null}
        {task ? <StatusPill task={task} busy={Boolean(busy)} elapsed={elapsed ?? null} /> : null}
      </header>
      <div className="sp-body">{children}</div>
    </div>
  );
}

function StatusPill({ task, busy, elapsed }: { task: Task; busy: boolean; elapsed: number | null }) {
  const tone: Tone = busy
    ? 'accent'
    : task.phase === 'done'
      ? 'good'
      : ['refused', 'failed', 'error'].includes(task.phase)
        ? 'bad'
        : ['awaiting_approval', 'reproduced', 'needs_info'].includes(task.phase)
          ? 'warn'
          : 'neutral';
  return (
    <span className={`status-pill tone-${tone}`} role="status">
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span key={shortPhase(task)} className="status-word">{shortPhase(task)}</span>
      {busy && elapsed !== null ? <span className="status-time">{fmtElapsed(elapsed)}</span> : null}
    </span>
  );
}

function shortPhase(task: Task): string {
  switch (task.phase) {
    case 'understanding':
      return 'Reading';
    case 'working':
      return task.run && !task.run.endedAt ? 'Kane running' : 'Working';
    case 'verifying':
      return 'Verifying';
    case 'awaiting_approval':
      return 'Needs you';
    case 'needs_info':
      return 'Needs detail';
    case 'reproduced':
      return kaneConfirmed(task.run) ? 'Bug confirmed' : 'Unconfirmed';
    case 'not_reproduced':
      return 'Not reproduced';
    case 'done':
      return task.result?.verified === false ? 'Done' : 'Verified';
    default:
      return phaseLabel(task);
  }
}

function Opening() {
  return (
    <div className="sp-opening" aria-live="polite">
      <p className="eyebrow">
        <span className="spinner" aria-hidden="true" /> Reading
      </p>
      <div className="shimmer w80" />
      <div className="shimmer w60" />
      <div className="shimmer-row">
        <div className="shimmer tile" />
        <div className="shimmer tile" />
        <div className="shimmer tile" />
      </div>
      <div className="shimmer w90 thin" />
      <div className="shimmer w70 thin" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Safeguards({ policy, trust, title = 'Safeguards', compact = false }: { policy: Policy; trust?: Task['requester']['trust']; title?: string; compact?: boolean }) {
  const decision = DECISION[policy.decision];
  const risk = RISK[policy.risk];
  const tiles = (
    <div className="sg-grid">
      {trust ? (
        <div className={`sg-tile${trust === 'unknown' ? ' tone-warn' : ''}`} data-tip={TRUST[trust].hint}>
          <span className="sg-k">Trust</span>
          <span className="sg-v">{TRUST[trust].label}</span>
        </div>
      ) : null}
      <div className="sg-tile" data-tip={risk.hint}>
        <span className="sg-k">Risk</span>
        <span className="sg-v">{risk.label}</span>
      </div>
      <div className={`sg-tile tone-${decision.tone}`} data-tip={decision.hint}>
        <span className="sg-k">Decision</span>
        <span className="sg-v">{decision.label}</span>
      </div>
    </div>
  );
  if (compact) return <div className="sg is-compact" aria-label={title}>{tiles}</div>;
  return (
    <section className="sp-section sg" aria-label={title}>
      {tiles}
      {policy.reasons.length ? (
        // The why is one click away; a refusal shows it straight away.
        <details className="sg-why" open={policy.decision === 'refuse'}>
          <summary>
            Why <ChevronIcon className="chev" />
          </summary>
          <ul className="sg-reasons">
            {policy.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

type StepState = 'done' | 'active' | 'waiting' | 'pending' | 'skipped';

function planProgress(task: Task, liveRun: KaneRun | null): StepState[] {
  const steps = task.plan?.steps || [];
  const tools = steps.map((s) => s.tool);
  const all = (state: StepState) => steps.map(() => state);
  const kaneFirst = tools.indexOf('kane');
  const kaneLast = tools.lastIndexOf('kane');
  const workIndex = tools.findIndex((t) => t === 'docs' || t === 'code');
  let active = -1;
  let state: StepState = 'active';
  switch (task.phase) {
    case 'done':
      return all('done');
    case 'refused':
    case 'dismissed':
      return all('skipped');
    case 'understanding':
    case 'awaiting_approval':
    case 'needs_info':
      return all('pending');
    case 'verifying':
      active = kaneLast;
      break;
    case 'working':
      if (liveRun) active = task.work ? kaneLast : kaneFirst;
      else active = task.kind === 'bug_report' && !task.work ? kaneFirst : workIndex;
      break;
    case 'reproduced':
      active = steps.findIndex((s, i) => i > kaneFirst && s.tool === 'code');
      state = 'waiting';
      break;
    default:
      return all('pending');
  }
  if (active < 0) return all('pending');
  return steps.map((_, i) => (i < active ? 'done' : i === active ? state : 'pending'));
}

const SETTLED: ReadonlySet<string> = new Set(['done', 'undone', 'dismissed', 'not_reproduced']);

function PlanSection({ task, liveRun }: { task: Task; liveRun: KaneRun | null }) {
  const steps = task.plan?.steps || [];
  const progress = planProgress(task, liveRun);
  if (task.phase === 'refused') return null;
  if (!steps.length && !task.plan?.verify) return null;
  const doneCount = progress.filter((p) => p === 'done').length;
  const note = !steps.length ? '' : `${doneCount}/${steps.length}`;
  // How far the rail between the step icons is filled: up to the last finished step, half into the current one.
  const reached = progress.lastIndexOf('done') + (progress.some((p) => p === 'active' || p === 'waiting') ? 0.5 : 0);
  const fill = steps.length > 1 ? Math.min(1, Math.max(0, reached / (steps.length - 1))) : 0;
  return (
    <section className="sp-section" aria-label="The plan">
      {/* Open while the plan matters; folded away once the result is in, so the result stays in view. */}
      <details className="plan-wrap" open={!SETTLED.has(task.phase)}>
        <summary className="sp-h">
          <SparkIcon /> Plan <span className="sp-h-note">{note}</span>
          <ChevronIcon className="chev" />
        </summary>
        <ol className="plan" style={{ ['--fill' as string]: fill }}>
          {steps.map((step, i) => {
            const state = progress[i] || 'pending';
            return (
              <li key={i} className={`plan-step is-${state}`}>
                <span className={`plan-icon tool-${step.tool}`}>
                  <ToolIcon tool={step.tool} />
                </span>
                <span className="plan-label">
                  {step.label}
                  {step.risk === 'modify' || step.risk === 'external' ? <span className={`tag tone-${RISK[step.risk].tone}`}>{RISK[step.risk].label}</span> : null}
                </span>
                <span className="plan-state" aria-label={state}>
                  {state === 'done' ? <CheckIcon className="draw" /> : state === 'active' ? <span className="spinner" /> : state === 'waiting' ? <HandIcon /> : null}
                </span>
              </li>
            );
          })}
        </ol>
        {task.plan?.verify ? (
          <div className="verify">
            <div className="verify-h">
              <KaneIcon /> Kane checks
            </div>
            <p>{task.plan.verify}</p>
          </div>
        ) : null}
        {task.spec && !BUSY.has(task.phase) && task.phase !== 'needs_info' ? (
          <details className="disclosure">
            <summary>
              <ChevronIcon className="chev" /> Understood as
            </summary>
            <SpecView spec={task.spec} />
          </details>
        ) : null}
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

type CardProps = {
  task: Task;
  now: number;
  busySince: number | null;
  liveRun: KaneRun | null;
  pending: string | null;
  fixReady: boolean;
  fixAgent: string | null;
  onApprove: () => void;
  onDismiss: () => void;
  onFix: () => void;
  onUndo: () => void;
  onRetry: () => void;
  onEditSpec: (spec: Record<string, unknown>) => void;
};

/** A site change runs the coding agent, so approving it is pointless while the agent can't start. */
function approveBlocked(props: { task: Task; fixReady: boolean }): boolean {
  return props.task.kind === 'site_change' && !props.fixReady;
}

/** Kane flags a confirmed product bug with result_code 740; any other failure may be Kane getting stuck. */
function kaneConfirmed(run: KaneRun | null | undefined) {
  return String(run?.runEnd?.result_code ?? '') === '740';
}

function StateCard(props: CardProps) {
  const { task, now, busySince, liveRun, pending } = props;
  const latest = task.run;

  if (BUSY.has(task.phase)) {
    const agentLines = task.log.filter((e) => e.source === 'agent').slice(-4);
    return (
      <section className="card card-live" aria-label="Progress">
        <AsciiField mode="scan" className="card-field" />
        <div className="live-head">
          <span className="spinner" aria-hidden="true" />
          <strong aria-live="polite">{phaseLabel(task)}</strong>
          {busySince ? <span className="elapsed">{fmtElapsed(now - busySince)}</span> : null}
        </div>
        {task.detail ? <p className="live-detail">{task.detail}</p> : null}
        <div className="live-bar" aria-hidden="true">
          <span />
        </div>
        {agentLines.length ? (
          <div className="feed">
            <div className="feed-h">
              <SparkIcon /> Agent
            </div>
            <ul>
              {agentLines.map((entry, i) => (
                <li key={`${entry.ts}-${i}`} style={{ opacity: 0.55 + (0.45 * (i + 1)) / agentLines.length }}>
                  {entry.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {liveRun ? <KaneSteps run={liveRun} live now={now} /> : null}
        {task.phase === 'verifying' && !liveRun ? <p className="fine">Queued: Kane runs one browser at a time.</p> : null}
      </section>
    );
  }

  switch (task.phase) {
    case 'awaiting_approval':
      return (
        <section className="card card-approve" aria-label="Approval">
          <div className="card-h">
            <HandIcon /> Needs your OK
          </div>
          <p>{task.detail || 'Nothing runs until you approve it.'}</p>
          <div className="row">
            <span title={approveBlocked(props) ? `${agentName(props.fixAgent)} isn't ready. Check the server's startup log.` : undefined}>
              <button type="button" className="btn btn-primary" onClick={props.onApprove} disabled={approveBlocked(props) || Boolean(pending)}>
                {pending === 'approve' ? 'Starting…' : 'Approve & run'}
              </button>
            </span>
            <button type="button" className="btn btn-ghost" onClick={props.onDismiss} disabled={Boolean(pending)}>
              Dismiss
            </button>
          </div>
          <p className="fine">
            {approveBlocked(props)
              ? `${agentName(props.fixAgent)} isn't ready on this machine, so approving is off.`
              : `Kane verifies it before ${task.requester.name?.split(' ')[0] || 'they'} hears back. Undo anytime.`}
          </p>
        </section>
      );

    case 'refused':
      return (
        <section className="card card-refused" aria-label="Refused">
          <div className="card-h">
            <ShieldOffIcon /> Refused
          </div>
          <p>{task.detail || task.policy.reasons.at(-1)}</p>
          <p className="fine">Nothing ran, nothing was sent. Check with {task.requester.name || 'the sender'} on a channel you trust.</p>
        </section>
      );

    case 'needs_info':
      return (
        <section className="card card-info" aria-label="Needs more detail">
          <div className="card-h">
            <PencilIcon /> Needs a bit more
          </div>
          <p>{task.detail}</p>
          {task.spec ? <SpecEditor spec={task.spec} pending={pending === 'edit'} onSave={props.onEditSpec} /> : null}
        </section>
      );

    case 'reproduced': {
      const verdict = latest?.runEnd?.verdict;
      const fix = task.fixPolicy;
      const agent = agentName(props.fixAgent);
      const canFix = task.app?.canFix && fix?.decision !== 'refuse';
      const confirmed = kaneConfirmed(latest);
      return (
        <section className={`card ${confirmed ? 'card-bug' : 'card-approve'}`} aria-label="Bug reproduced">
          <div className="card-h">
            <BugIcon /> {confirmed ? (verdict?.severity ? `Kane confirmed a ${verdict.severity} bug` : 'Kane confirmed the bug') : "Kane couldn't confirm it"}
          </div>
          <p>{(latest && runSummary(latest)) || task.detail}</p>
          {confirmed ? null : <p className="fine">The steps failed, but Kane didn't flag a product bug. Check the evidence before fixing.</p>}
          {verdict?.root_cause && verdict.root_cause !== (latest && runSummary(latest)) ? <p className="fine">Root cause: {verdict.root_cause}</p> : null}
          {fix ? (
            <div className="fix-policy">
              <p className="eyebrow">If you fix it</p>
              <Safeguards policy={fix} compact />
            </div>
          ) : null}
          {canFix ? (
            <>
              <div className="row">
                <span title={props.fixReady ? undefined : `${agent} isn't ready. Check the server's startup log.`}>
                  <button type="button" className="btn btn-primary" onClick={props.onFix} disabled={!props.fixReady || Boolean(pending)}>
                    <CodeGlyph /> {pending === 'fix' ? 'Starting…' : `Fix it with ${agent}`}
                  </button>
                </span>
              </div>
              <p className="fine">
                {props.fixReady
                  ? `Edits ${task.app?.name || 'the app'}'s code, then Kane re-checks. Up to 3 rounds, undoable.`
                  : `${agent[0]!.toUpperCase()}${agent.slice(1)} isn't ready here, so fixing is off.`}
              </p>
            </>
          ) : (
            <p className="fine">{task.app ? `${task.app.name} has no fix agent set up.` : 'Not one of your apps.'}</p>
          )}
        </section>
      );
    }

    case 'not_reproduced':
      return (
        <section className="card card-neutral" aria-label="Not reproduced">
          <div className="card-h">
            <KaneIcon /> Kane couldn&rsquo;t reproduce it
          </div>
          <p>{(latest && runSummary(latest)) || task.detail}</p>
          <p className="fine">Worked as expected in a clean browser. The draft asks for more detail.</p>
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={props.onRetry} disabled={Boolean(pending)}>
              <RetryIcon /> {pending === 'retry' ? 'Starting…' : 'Try again'}
            </button>
          </div>
        </section>
      );

    case 'done': {
      const link = task.result?.link;
      const verified = task.result?.verified !== false;
      return (
        <section className={`card ${verified ? 'card-done' : 'card-neutral'}`} aria-label="Result">
          <div className="card-h">
            <SealIcon className="draw" /> {verified ? 'Verified by Kane' : 'Done'}
          </div>
          <p>{task.detail}</p>
          {task.result?.proof ? (
            <blockquote className="proof">
              <KaneIcon /> <span>{task.result.proof}</span>
            </blockquote>
          ) : null}
          <div className="row">
            {link ? (
              <a className="btn btn-primary" href={link} target="_blank" rel="noreferrer">
                {task.kind === 'document' ? 'Open the doc' : 'Open the page'} <ArrowOutIcon />
              </a>
            ) : null}
            {task.undo?.available ? (
              <button type="button" className="btn btn-ghost" onClick={props.onUndo} disabled={Boolean(pending)}>
                <UndoIcon /> {pending === 'undo' ? 'Undoing…' : task.undo.label || 'Undo'}
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    case 'failed':
    case 'error':
      return (
        <section className="card card-failed" aria-label={task.phase === 'failed' ? 'Did not pass' : 'Error'}>
          <div className="card-h">
            <AlertIcon /> {task.phase === 'failed' ? 'Kane could not verify it' : 'Something went wrong'}
          </div>
          <p>{task.detail}</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={props.onRetry} disabled={Boolean(pending)}>
              <RetryIcon /> {pending === 'retry' ? 'Starting…' : 'Retry'}
            </button>
            {task.undo?.available ? (
              <button type="button" className="btn btn-ghost" onClick={props.onUndo} disabled={Boolean(pending)}>
                <UndoIcon /> {task.undo.label || 'Undo'}
              </button>
            ) : null}
          </div>
          <p className="fine">Nothing was sent.</p>
        </section>
      );

    case 'dismissed':
    case 'undone':
      return (
        <section className="card card-neutral" aria-label={task.phase === 'dismissed' ? 'Dismissed' : 'Undone'}>
          <div className="card-h">
            {task.phase === 'dismissed' ? <CrossIcon /> : <UndoIcon />} {task.phase === 'dismissed' ? 'Dismissed' : 'Undone'}
          </div>
          <p>{task.detail || (task.phase === 'dismissed' ? 'Seyrin will leave this one to you.' : 'Everything Seyrin changed is back the way it was.')}</p>
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={props.onRetry} disabled={Boolean(pending)}>
              <RetryIcon /> {pending === 'retry' ? 'Starting…' : 'Start over'}
            </button>
          </div>
        </section>
      );

    default:
      return null;
  }
}

const CodeGlyph = () => <ToolIcon tool="code" />;

function ActionBar(props: {
  task: Task;
  liveRun: KaneRun | null;
  elapsed: number | null;
  pending: string | null;
  fixReady: boolean;
  fixAgent: string | null;
  onApprove: () => void;
  onFix: () => void;
  onRetry: () => void;
  onJump: () => void;
}) {
  const { task, liveRun, pending } = props;
  const jump = (text: string) => (
    <button type="button" className="link ab-jump" onClick={props.onJump}>
      {text} ↓
    </button>
  );
  let body: ReactNode = null;
  if (BUSY.has(task.phase)) {
    const step = liveRun?.steps?.length ? [...liveRun.steps].sort((a, b) => a.step - b.step).at(-1) : null;
    const stepText = step ? cleanRemark(step.remark) || `step ${liveRun!.steps.length}` : '';
    body = (
      <>
        <span className="spinner" aria-hidden="true" />
        <span className="ab-text">
          <strong>{phaseLabel(task)}</strong>
          {stepText ? <span className="ab-sub"> · {stepText}</span> : null}
        </span>
        {props.elapsed !== null ? <span className="elapsed">{fmtElapsed(props.elapsed)}</span> : null}
        {jump('Progress')}
      </>
    );
  } else if (task.phase === 'awaiting_approval') {
    body = (
      <>
        <HandIcon className="ab-icon tone-warn" />
        <span className="ab-text">
          <strong>Needs your approval</strong>
        </span>
        {jump('Review')}
        <button type="button" className="btn btn-primary btn-sm" onClick={props.onApprove} disabled={approveBlocked(props) || Boolean(pending)} title={approveBlocked(props) ? 'The coding agent is not ready' : undefined}>
          Approve &amp; run
        </button>
      </>
    );
  } else if (task.phase === 'reproduced') {
    const severity = task.run?.runEnd?.verdict?.severity;
    const canFix = task.app?.canFix && task.fixPolicy?.decision !== 'refuse';
    body = (
      <>
        <BugIcon className="ab-icon tone-bad" />
        <span className="ab-text">
          <strong>{severity ? `Confirmed ${severity} bug` : 'Bug reproduced'}</strong>
        </span>
        {jump('Details')}
        {canFix ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={props.onFix} disabled={!props.fixReady || Boolean(pending)} title={props.fixReady ? undefined : 'The fix agent is not ready'}>
            Fix it
          </button>
        ) : null}
      </>
    );
  } else if (task.phase === 'done') {
    body = (
      <>
        <SealIcon className="ab-icon tone-good" />
        <span className="ab-text">
          <strong>{task.result?.verified === false ? 'Done' : 'Verified by Kane'}</strong>
        </span>
        {jump('Result')}
        {task.result?.link ? (
          <a className="btn btn-primary btn-sm" href={task.result.link} target="_blank" rel="noreferrer">
            {task.kind === 'document' ? 'Open the doc' : 'Open the page'} <ArrowOutIcon />
          </a>
        ) : null}
      </>
    );
  } else if (task.phase === 'failed' || task.phase === 'error') {
    body = (
      <>
        <AlertIcon className="ab-icon tone-bad" />
        <span className="ab-text">
          <strong>{task.phase === 'failed' ? 'Kane could not verify it' : 'Something went wrong'}</strong>
        </span>
        {jump('Details')}
        <button type="button" className="btn btn-primary btn-sm" onClick={props.onRetry} disabled={Boolean(pending)}>
          Retry
        </button>
      </>
    );
  } else if (task.phase === 'needs_info') {
    body = (
      <>
        <PencilIcon className="ab-icon tone-info" />
        <span className="ab-text">
          <strong>Seyrin needs a bit more</strong>
        </span>
        {jump('Fill in')}
      </>
    );
  }
  if (!body) return null;
  return (
    <div className="action-bar" role="region" aria-label="Current step" key={task.phase}>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function KaneSteps({ run, live = false, now = Date.now() }: { run: KaneRun; live?: boolean; now?: number }) {
  const steps = [...(run.steps || [])].sort((a, b) => a.step - b.step);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el && live) el.scrollTop = el.scrollHeight;
  }, [steps.length, live]);
  return (
    <div className="ksteps">
      <div className="ksteps-h">
        <KaneIcon /> <span>Kane{run.label ? ` · ${run.label}` : ''}</span>
        {live ? <span className="elapsed">{fmtElapsed(now - (Date.parse(run.startedAt) || now))}</span> : null}
      </div>
      <ol ref={listRef} className={live ? 'is-live' : undefined}>
        {steps.map((step, i) => {
          const text = cleanRemark(step.remark);
          return (
            <li key={step.step} className={`kstep is-${step.status}`}>
              <span key={step.status} className="kstep-mark" aria-label={step.status}>
                {step.status === 'done' ? '✓' : step.status === 'failed' ? '✕' : '•'}
              </span>
              <span className="kstep-n">{i + 1}</span>
              <span className="kstep-text">{text || (step.status === 'running' ? 'Thinking…' : `Step ${i + 1}`)}</span>
            </li>
          );
        })}
        {live && !steps.length ? (
          <li className="kstep is-running">
            <span className="kstep-mark">•</span>
            <span className="kstep-n" />
            <span className="kstep-text">Opening a browser…</span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function Evidence({ task, run, busy, onOpen }: { task: Task; run: KaneRun; busy: boolean; onOpen: (run: KaneRun) => void }) {
  const verdict = verdictLine(run);
  const summary = runSummary(run);
  const end = run.runEnd;
  const earlier = (task.runs || []).filter((r) => r !== run && (r.endedAt || r.runEnd));
  const sameRun = (a: KaneRun) => a.attempt === run.attempt && a.startedAt === run.startedAt;
  return (
    <section className="sp-section" aria-label="Evidence">
      <h3 className="sp-h">
        <KaneIcon /> Evidence
      </h3>
      <div className="evidence">
        {run.screenshot ? (
          <button type="button" className="shot" onClick={() => onOpen(run)} title="Open Kane's evidence viewer">
            <img src={shotUrl(run.screenshot)} alt={`Kane's last screenshot from the ${run.label || 'run'}`} loading="lazy" />
            <span className="shot-cta">
              Open <ArrowOutIcon />
            </span>
          </button>
        ) : (
          <div className="shot is-empty">
            <ImageIcon size={18} />
            <span>No screenshot</span>
          </div>
        )}
        <div className="ev-meta">
          {verdict ? <span className={`tag tone-${verdict.tone}`}>{verdict.label}</span> : null}
          {summary ? <p className="ev-summary">{summary}</p> : null}
          <div className="ev-links">
            <button type="button" className="link" onClick={() => onOpen(run)}>
              Evidence <ArrowOutIcon />
            </button>
            {end?.test_url ? (
              <a className="link" href={end.test_url} target="_blank" rel="noreferrer">
                Test Manager <ArrowOutIcon />
              </a>
            ) : null}
          </div>
          <p className="ev-stats">
            {[run.label, `run ${run.attempt}`, end?.duration ? `${Math.round(end.duration)}s` : null, run.steps?.length ? `${run.steps.length} steps` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      {!busy && run.steps?.length ? (
        <details className="disclosure">
          <summary>
            <ChevronIcon className="chev" /> Kane&rsquo;s steps ({run.steps.length})
          </summary>
          <KaneSteps run={run} />
        </details>
      ) : null}
      {earlier.filter((r) => !sameRun(r)).length ? (
        <ul className="runs">
          {earlier
            .filter((r) => !sameRun(r))
            .map((r) => {
              const v = verdictLine(r);
              return (
                <li key={`${r.attempt}-${r.startedAt}`}>
                  <span className="runs-n">Run {r.attempt}</span>
                  <span className="runs-label">{r.label}</span>
                  {v ? <span className={`tag tone-${v.tone}`}>{v.label}</span> : null}
                  <button type="button" className="link" onClick={() => onOpen(r)}>
                    Evidence <ArrowOutIcon />
                  </button>
                </li>
              );
            })}
        </ul>
      ) : null}
    </section>
  );
}

const GOOD_VERDICTS = new Set(['passed', 'not_reproduced', 'fixed', 'verified']);
const BAD_VERDICTS = new Set(['failed', 'reproduced', 'error']);

function Attempts({ attempts, agent, kind }: { attempts: WorkAttempt[]; agent: string; kind: Task['kind'] }) {
  return (
    <section className="sp-section" aria-label="Work attempts">
      <h3 className="sp-h">
        <ToolIcon tool="code" /> Work attempts <span className="sp-h-note">{agentName(agent)}</span>
      </h3>
      <ol className="attempts">
        {attempts.map((attempt) => {
          // For a bug fix, Kane re-running the steps and NOT reproducing the bug is the pass.
          const passed = Boolean(attempt.verdict && GOOD_VERDICTS.has(attempt.verdict));
          const failed = Boolean(attempt.verdict && BAD_VERDICTS.has(attempt.verdict));
          return (
            <li key={attempt.n} className="attempt">
              <div className="attempt-h">
                <span className="attempt-n">{kind === 'bug_report' ? `Attempt ${attempt.n} of 3` : `Attempt ${attempt.n}`}</span>
                {attempt.verdict ? (
                  <span className={`tag tone-${passed ? 'good' : failed ? 'bad' : 'neutral'}`}>
                    {passed ? 'Kane: passed' : failed ? (kind === 'bug_report' ? 'Kane: still broken' : 'Kane: failed') : attempt.verdict.replace(/_/g, ' ')}
                  </span>
                ) : (
                  <span className="tag tone-accent">In progress</span>
                )}
              </div>
              {attempt.summary ? <p>{attempt.summary}</p> : null}
              {attempt.detail ? <p className="fine">{attempt.detail}</p> : null}
              {attempt.diff ? <Diff text={attempt.diff} /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Diff({ text }: { text: string }) {
  const lines = text.replace(/\n$/, '').split('\n');
  const added = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const removed = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  return (
    <details className="disclosure diff-wrap">
      <summary>
        <ChevronIcon className="chev" /> Diff <span className="diff-stat good">+{added}</span> <span className="diff-stat bad">−{removed}</span>
      </summary>
      <pre className="diff">
        {lines.map((line, i) => {
          const cls = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')
            ? 'd-meta'
            : line.startsWith('@@')
              ? 'd-hunk'
              : line.startsWith('+')
                ? 'd-add'
                : line.startsWith('-')
                  ? 'd-del'
                  : '';
          return (
            <span key={i} className={cls}>
              {line || ' '}
              {'\n'}
            </span>
          );
        })}
      </pre>
    </details>
  );
}

function Audit({ log, extractor }: { log: LogEntry[]; extractor: string | null }) {
  return (
    <details className="audit">
      <summary>
        <ChevronIcon className="chev" /> Audit log <span className="sp-h-note">{log.length}{extractor ? ` · ${extractor === 'openai' ? 'OpenAI' : extractor}` : ''}</span>
      </summary>
      <ol>
        {log.map((entry, i) => (
          <li key={`${entry.ts}-${i}`}>
            <time dateTime={entry.ts}>{fmtClock(entry.ts)}</time>
            <span className={`src src-${entry.source}`}>{entry.source}</span>
            <span className="audit-text">{entry.text}</span>
          </li>
        ))}
        {log.length ? null : <li className="fine">Nothing logged yet.</li>}
      </ol>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------

const LABELS: Record<string, string> = {
  url: 'Page',
  steps: 'Steps',
  expected: 'Expected',
  actual: 'Actual',
  summary: 'Summary',
  title: 'Title',
  sections: 'Sections',
  audience: 'Audience',
  context: 'Context',
  change: 'Change',
  missing: 'Missing',
};

const label = (key: string) => LABELS[key] || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function SpecView({ spec }: { spec: Record<string, unknown> }) {
  const missing = Array.isArray(spec.missing) ? (spec.missing as string[]) : [];
  const entries = Object.entries(spec).filter(([key]) => key !== 'missing');
  return (
    <dl className="spec">
      {entries.map(([key, value]) => (
        <div key={key} className={missing.includes(key) ? 'is-missing' : undefined}>
          <dt>{label(key)}</dt>
          <dd>
            {Array.isArray(value) ? (
              value.length ? (
                <ul>
                  {value.map((item, i) => (
                    <li key={i}>{String(item)}</li>
                  ))}
                </ul>
              ) : (
                <span className="fine">None</span>
              )
            ) : value === null || value === '' || value === undefined ? (
              <span className="fine">{missing.includes(key) ? 'Missing' : 'Not given'}</span>
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
      {missing
        .filter((key) => !(key in spec))
        .map((key) => (
          <div key={key} className="is-missing">
            <dt>{label(key)}</dt>
            <dd>
              <span className="fine">Missing</span>
            </dd>
          </div>
        ))}
    </dl>
  );
}

function SpecEditor({ spec, pending, onSave }: { spec: Record<string, unknown>; pending: boolean; onSave: (spec: Record<string, unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const missing = Array.isArray(spec.missing) ? (spec.missing as string[]) : [];
  const keys = useMemo(() => [...new Set([...Object.keys(spec).filter((k) => k !== 'missing'), ...missing])], [spec, missing]);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(keys.map((k) => [k, Array.isArray(spec[k]) ? (spec[k] as unknown[]).join('\n') : spec[k] == null ? '' : String(spec[k])])),
  );
  if (!editing) {
    return (
      <>
        <SpecView spec={spec} />
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
            <PencilIcon /> Fill in the details
          </button>
        </div>
      </>
    );
  }
  return (
    <form
      className="spec-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next: Record<string, unknown> = {};
        for (const key of keys) {
          const value = draft[key] ?? '';
          next[key] = Array.isArray(spec[key]) ? value.split('\n').map((s) => s.trim()).filter(Boolean) : value.trim() || null;
        }
        onSave(next);
      }}
    >
      {keys.map((key) => (
        <label key={key} className={missing.includes(key) ? 'is-missing' : undefined}>
          <span>
            {label(key)}
            {missing.includes(key) ? <span className="tag tone-warn">Missing</span> : null}
            {Array.isArray(spec[key]) ? <span className="fine"> one per line</span> : null}
          </span>
          {Array.isArray(spec[key]) ? (
            <textarea rows={3} value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          ) : (
            <input value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          )}
        </label>
      ))}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Starting…' : 'Run again'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
