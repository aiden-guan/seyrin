// Seyrin inbox: a demo mailbox for the founder of Perch, with Seyrin working beside every email.
import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { classifyRequest } from '../../core/intent.ts';
import { api, onEvent, type Health, type OutgoingEmail, type Person, type Task, type TaskSummary, type Trust } from './api.ts';
import { KaneConsole } from './console.tsx';
import { FIXTURES, ME, PERCH_URL, STARTERS, type DemoMail } from './fixtures.ts';
import { KIND_LABEL, TRUST, fmtAgo, fmtWhen, initials, rowState } from './format.ts';
import { ArrowOutIcon, ComposeIcon, CrossIcon, RetryIcon, SeyrinMark } from './icons.tsx';
import { SeyrinPanel } from './panel.tsx';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/jersey-15/400.css';
import './app.css';

const CUSTOM_KEY = 'seyrin-inbox-custom';
const CONSOLE_KEY = 'seyrin-console-open';
const LOADED_AT = Date.now();

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function minutesAgo(mail: DemoMail, now: number): number {
  if (mail.receivedAt) return (now - Date.parse(mail.receivedAt)) / 60000;
  return (mail.minutesAgo ?? 0) + (now - LOADED_AT) / 60000;
}

function toOutgoing(mail: DemoMail): OutgoingEmail {
  return { threadId: mail.threadId, subject: mail.subject, from: mail.from, bodyText: mail.bodyText };
}

// ---------------------------------------------------------------------------------------------

function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  const check = useCallback(() => {
    api
      .health()
      .then((h) => {
        setHealth(h);
        setDown(false);
      })
      .catch(() => setDown(true));
  }, []);
  useEffect(() => {
    check();
    const timer = setInterval(check, 15000);
    const off = onEvent('open', check);
    return () => {
      clearInterval(timer);
      off();
    };
  }, [check]);
  return { health, down };
}

/** threadId → the newest task's phase, from GET /v1/tasks and then the global event stream. */
function useBoard() {
  const [board, setBoard] = useState<Record<string, TaskSummary>>({});
  useEffect(() => {
    const load = () =>
      api
        .tasks()
        .then(({ tasks }) => {
          const sorted = [...tasks].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
          setBoard(Object.fromEntries(sorted.map((t) => [t.threadId, { id: t.id, threadId: t.threadId, kind: t.kind, phase: t.phase }])));
        })
        .catch(() => {});
    load();
    const offs = [
      onEvent('open', load),
      onEvent('state', (s: TaskSummary) => {
        if (!s?.threadId || !s.phase) return;
        setBoard((prev) => ({ ...prev, [s.threadId]: { ...prev[s.threadId], ...s } }));
      }),
      onEvent('reset', () => setBoard({})),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  return [board, setBoard] as const;
}

function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// ---------------------------------------------------------------------------------------------

/** Trust as the inbox can tell it before Seyrin has looked: known people, your domain, look-alikes. */
function trustFor(from: DemoMail['from'], people: Person[]): { trust: Trust; note?: string } {
  const email = from.email.toLowerCase();
  const person = people.find((p) => p.email.toLowerCase() === email);
  const namesake = people.find((p) => p.trust === 'team' && p.name && p.name.toLowerCase() === from.name.toLowerCase() && p.email.toLowerCase() !== email);
  if (namesake) return { trust: 'unknown', note: `Not ${namesake.name}'s address (${namesake.email})` };
  if (person) return { trust: person.trust, note: person.role ? `Your ${person.role}` : undefined };
  if (email.endsWith(`@${ME.email.split('@')[1]}`)) return { trust: 'team', note: 'Your team’s domain' };
  return { trust: 'unknown' };
}

const FALLBACK_PEOPLE: Person[] = [
  { name: 'Jordan Reyes', email: 'jordan@perch.studio', trust: 'team', role: 'cofounder' },
  { name: 'Maya Chen', email: 'maya@lunayoga.studio', trust: 'known', role: 'customer' },
];

function App() {
  const [custom, setCustom] = useState<DemoMail[]>(() => {
    const stored = readStore<DemoMail[]>(CUSTOM_KEY, []);
    return Array.isArray(stored) ? stored.filter((m) => m && typeof m.threadId === 'string' && m.from?.email) : [];
  });
  const mails = useMemo(() => [...custom, ...FIXTURES], [custom]);
  const [openId, setOpenId] = useState<string>(FIXTURES[0]!.threadId);
  const [composing, setComposing] = useState(false);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [consoleOpen, setConsoleOpen] = useState<boolean>(() => readStore(CONSOLE_KEY, true));
  const [epoch, setEpoch] = useState(0);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [resetting, setResetting] = useState(false);
  const { health, down } = useHealth();
  const [board, setBoard] = useBoard();
  const now = useMinuteTick();
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const open = mails.find((m) => m.threadId === openId) || mails[0]!;
  const people = health?.people?.length ? health.people : FALLBACK_PEOPLE;
  const outgoing = useMemo(() => toOutgoing(open), [open]);

  useEffect(() => writeStore(CONSOLE_KEY, consoleOpen), [consoleOpen]);

  const onTask = useCallback(
    (task: Task) => {
      setOpenTask(task);
      setBoard((prev) => {
        const current = prev[task.threadId];
        if (current && current.id === task.id && current.phase === task.phase) return prev;
        return { ...prev, [task.threadId]: { id: task.id, threadId: task.threadId, kind: task.kind, phase: task.phase } };
      });
    },
    [setBoard],
  );

  const applyReply = useCallback(
    (text: string) => {
      setReplies((r) => ({ ...r, [open.threadId]: text }));
      requestAnimationFrame(() => {
        replyRef.current?.focus();
        replyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [open.threadId],
  );

  const addMail = (mail: DemoMail) => {
    const next = [mail, ...custom];
    setCustom(next);
    writeStore(CUSTOM_KEY, next);
    setOpenId(mail.threadId);
  };

  const resetDemo = async () => {
    if (!window.confirm('Reset the demo?\n\nThis clears every task and document, puts Perch’s planted bugs back, and removes emails you wrote.')) return;
    setResetting(true);
    try {
      await api.reset();
    } catch (error) {
      window.alert(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    setResetting(false);
    setCustom([]);
    writeStore(CUSTOM_KEY, []);
    setReplies({});
    setBoard({});
    setOpenTask(null);
    setOpenId(FIXTURES[0]!.threadId);
    setEpoch((n) => n + 1);
  };

  const subjectFor = useCallback(
    (taskId: string) => {
      const entry = Object.values(board).find((b) => b.id === taskId);
      const mail = entry ? mails.find((m) => m.threadId === entry.threadId) : null;
      return mail ? mail.subject : null;
    },
    [board, mails],
  );

  const needsYou = mails.filter((m) => {
    const b = board[m.threadId];
    return b && rowState(b.phase).needsYou;
  }).length;

  const openTrust = openTask && openTask.threadId === open.threadId ? { trust: openTask.requester.trust, note: openTask.requester.role ? `Your ${openTask.requester.role}` : undefined } : null;
  const guessed = trustFor(open.from, people);
  const trust = openTrust && !guessed.note?.startsWith('Not ') ? { ...guessed, ...openTrust, note: openTrust.note || guessed.note } : guessed;
  const received = new Date(now - minutesAgo(open, now) * 60000);

  return (
    <div className={`app${consoleOpen ? ' has-console' : ''}`}>
      <a className="skip" href="#seyrin-panel">
        Skip to Seyrin
      </a>
      <TopBar health={health} down={down} resetting={resetting} onReset={resetDemo} />

      <aside className="list" aria-label="Inbox">
        <div className="list-head">
          <h2>Inbox</h2>
          <span className="count">{mails.length}</span>
          {needsYou ? (
            <span key={needsYou} className="needs">
              {needsYou} need{needsYou === 1 ? 's' : ''} you
            </span>
          ) : null}
          <button type="button" className="icon-btn icon-btn-solid" onClick={() => setComposing(true)} aria-label="Write an email" data-tip="Write an email" data-tip-pos="left">
            <ComposeIcon />
          </button>
        </div>
        <Rows openId={open.threadId} watch={board}>
          {mails.map((mail, i) => (
            <li key={mail.threadId} data-thread={mail.threadId} style={{ ['--i' as string]: i }}>
              <MailRow mail={mail} open={mail.threadId === open.threadId} summary={board[mail.threadId]} now={now} onOpen={() => setOpenId(mail.threadId)} />
            </li>
          ))}
        </Rows>
      </aside>

      <main className="thread" aria-labelledby="thread-subject">
        <article className="thread-inner" key={open.threadId}>
          <h1 id="thread-subject">{open.subject}</h1>
          <div className="from">
            <span className="avatar" aria-hidden="true">
              {initials(open.from.name)}
            </span>
            <div className="from-text">
              <div className="from-line">
                <strong>{open.from.name}</strong>
                <span className="from-email">&lt;{open.from.email}&gt;</span>
                {trust.trust === 'unknown' ? (
                  <span className="tag tone-warn" title={TRUST[trust.trust].hint}>
                    {TRUST[trust.trust].label}
                  </span>
                ) : null}
              </div>
              <div className="from-meta">
                {fmtWhen(received)}
                {trust.note ? <span className={trust.note.startsWith('Not ') ? 'warn-note' : undefined}> · {trust.note}</span> : null}
              </div>
            </div>
          </div>
          <div className="body">{open.bodyText}</div>
          <div className="reply">
            <label htmlFor="reply-box" className="sr-only">
              Reply to {open.from.name}
            </label>
            <textarea
              id="reply-box"
              ref={replyRef}
              placeholder={`Reply to ${open.from.name.split(' ')[0]}…`}
              value={replies[open.threadId] || ''}
              onChange={(e) => setReplies({ ...replies, [open.threadId]: e.target.value })}
              rows={5}
            />
            <div className="reply-bar">
              {replies[open.threadId] ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplies({ ...replies, [open.threadId]: '' })}>
                  Clear
                </button>
              ) : null}
              <span data-tip="Demo inbox: nothing is sent" data-tip-pos="left">
                <button type="button" className="btn btn-primary btn-sm" disabled aria-describedby="send-note">
                  Send
                </button>
              </span>
              <span id="send-note" className="sr-only">
                Demo inbox. Nothing is sent.
              </span>
            </div>
          </div>
        </article>
      </main>

      <aside className="panel" id="seyrin-panel" aria-label="Seyrin" tabIndex={-1}>
        <SeyrinPanel key={`${open.threadId}:${epoch}`} email={outgoing} health={health} onTask={onTask} onUseReply={applyReply} />
      </aside>

      <KaneConsole open={consoleOpen} onToggle={() => setConsoleOpen((v) => !v)} subjectFor={subjectFor} />

      {composing ? (
        <Compose
          people={people}
          onClose={() => setComposing(false)}
          onAdd={(mail) => {
            addMail(mail);
            setComposing(false);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function TopBar({ health, down, resetting, onReset }: { health: Health | null; down: boolean; resetting: boolean; onReset: () => void }) {
  const perch = health?.apps?.find((a) => a.id === 'perch') || health?.apps?.find((a) => a.canFix) || null;
  const kaneOk = Boolean(health?.kane.installed && health.kane.signedIn);
  return (
    <header className="top">
      <div className="brand">
        <SeyrinMark size={22} title="Seyrin" />
        <span className="wordmark">Seyrin</span>
      </div>
      {/* Status only speaks up when something is wrong. */}
      <div className="top-status" aria-label="System status">
        {down ? <span className="alert tone-bad">Seyrin server offline · run npm start</span> : null}
        {health && !kaneOk ? (
          <span className="alert tone-warn">{health.kane.installed ? 'Kane CLI not signed in · kane-cli login' : 'Kane CLI not installed'}</span>
        ) : null}
        {health && perch && !perch.fixReady ? (
          <span className="alert tone-warn" title={`Fix agent: ${perch.fixAgent || 'none'}`}>
            {perch.name} fix agent not ready
          </span>
        ) : null}
      </div>
      <nav className="top-links" aria-label="Demo links">
        <a className="top-link" href={PERCH_URL} target="_blank" rel="noreferrer">
          Perch <ArrowOutIcon />
        </a>
        <a className="top-link" href="/d" target="_blank" rel="noreferrer">
          Docs <ArrowOutIcon />
        </a>
        <button type="button" className={`icon-btn${resetting ? ' is-spinning' : ''}`} onClick={onReset} disabled={resetting} aria-label={resetting ? 'Resetting…' : 'Reset demo'} data-tip="Reset demo" data-tip-pos="left">
          <RetryIcon />
        </button>
      </nav>
    </header>
  );
}

/** The inbox list, with one highlight that glides to the open row instead of jumping. */
function Rows({ openId, watch, children }: { openId: string; watch: unknown; children: ReactNode }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [box, setBox] = useState<{ y: number; h: number } | null>(null);
  const place = useCallback(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`li[data-thread="${CSS.escape(openId)}"]`);
    if (row) setBox({ y: row.offsetTop, h: row.offsetHeight });
  }, [openId]);
  useLayoutEffect(place, [place, watch]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  }, [place]);
  return (
    <ul className="rows" ref={listRef}>
      {box ? <span className="row-glow" aria-hidden="true" style={{ transform: `translateY(${box.y}px)`, height: box.h }} /> : null}
      {children}
    </ul>
  );
}

function MailRow({ mail, open, summary, now, onOpen }: { mail: DemoMail; open: boolean; summary?: TaskSummary; now: number; onOpen: () => void }) {
  const intent = useMemo(() => classifyRequest({ subject: mail.subject, bodyText: mail.bodyText, from: mail.from }), [mail]);
  const kind = summary?.kind || intent.kind;
  const state = summary ? rowState(summary.phase) : null;
  return (
    <button type="button" className={`row${open ? ' is-open' : ''}`} onClick={onOpen} aria-current={open ? 'true' : undefined}>
      <span className="row-top">
        <span className="row-sender">{mail.from.name}</span>
        <span className="row-time">{mail.custom && minutesAgo(mail, now) < 1 ? 'now' : fmtAgo(minutesAgo(mail, now))}</span>
      </span>
      <span className="row-subject">{mail.subject}</span>
      <span className="row-snippet">{mail.bodyText.replace(/\s+/g, ' ').slice(0, 110)}</span>
      {state ? (
        <span key={state.label} className={`row-state tone-${state.tone}`} title={kind ? KIND_LABEL[kind] : undefined}>
          {state.live ? <span className="spinner" aria-hidden="true" /> : null}
          {state.label}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------

const OTHER = '__other__';

function Compose({ people, onClose, onAdd }: { people: Person[]; onClose: () => void; onAdd: (mail: DemoMail) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const senders = useMemo(() => {
    const seen = new Set<string>();
    const list: { name: string; email: string; note: string }[] = [];
    for (const p of people) {
      if (seen.has(p.email.toLowerCase())) continue;
      seen.add(p.email.toLowerCase());
      list.push({ name: p.name || p.email, email: p.email, note: `${TRUST[p.trust].label}${p.role ? ` · ${p.role}` : ''}` });
    }
    for (const m of FIXTURES) {
      if (seen.has(m.from.email.toLowerCase()) || /newsletter/i.test(m.from.email)) continue;
      seen.add(m.from.email.toLowerCase());
      list.push({ name: m.from.name, email: m.from.email, note: 'from your inbox' });
    }
    return list;
  }, [people]);
  const [sender, setSender] = useState<string>(senders[0]?.email || OTHER);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const chosen = senders.find((s) => s.email === sender) || null;

  return (
    <dialog
      ref={dialogRef}
      className="compose"
      aria-labelledby="compose-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <form
        className="compose-form"
        onSubmit={(e) => {
          e.preventDefault();
          const from = chosen ? { name: chosen.name, email: chosen.email } : { name: name.trim() || email.trim() || 'Someone', email: email.trim() || 'someone@example.com' };
          onAdd({
            threadId: `custom-${Date.now().toString(36)}`,
            from,
            subject: subject.trim() || '(no subject)',
            bodyText: body.trim(),
            receivedAt: new Date().toISOString(),
            custom: true,
          });
        }}
      >
        <div className="compose-head">
          <div>
            <h2 id="compose-title">New email</h2>
            <p className="fine">Lands in your inbox as if they sent it.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CrossIcon />
          </button>
        </div>

        <div className="starters" role="group" aria-label="Start from an example">
          <span className="eyebrow">Try</span>
          {STARTERS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="chip-btn"
              onClick={() => {
                setSubject(s.subject);
                setBody(s.body);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>From</span>
          <select value={sender} onChange={(e) => setSender(e.target.value)}>
            {senders.map((s) => (
              <option key={s.email} value={s.email}>
                {s.name} · {s.email} ({s.note})
              </option>
            ))}
            <option value={OTHER}>Someone else…</option>
          </select>
        </label>
        {sender === OTHER ? (
          <div className="field-grid">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Reyes" autoComplete="off" />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" required autoComplete="off" />
            </label>
          </div>
        ) : null}
        <label className="field">
          <span>Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Upgrade button does nothing" required autoComplete="off" />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            required
            placeholder="Ask for a doc, report a bug on Perch, or request a site change."
          />
        </label>
        <div className="compose-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Add to inbox
          </button>
        </div>
      </form>
    </dialog>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
