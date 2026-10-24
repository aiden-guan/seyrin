// The Seyrin server API (docs/API.md). The inbox is served from the same origin as the server,
// and `npm run app:dev` proxies these paths, so every call is relative.
import type { Decision, PlanStep, Risk, TaskKind, TaskPhase, Trust } from '../../core/types.ts';

export type { Decision, Risk, TaskKind, TaskPhase, Trust };

export type Policy = { decision: Decision; risk: Risk; reasons: string[] };

export type KaneStep = { step: number; status: 'running' | 'done' | 'failed'; remark: string };

export type KaneVerdict = { severity?: string; category?: string; root_cause?: string; bug_title?: string; confidence?: number };

export type KaneRun = {
  label: string;
  attempt: number;
  objective: string;
  startedAt: string;
  endedAt: string | null;
  steps: KaneStep[];
  exitCode: number | null;
  runEnd: {
    status?: 'passed' | 'failed';
    one_liner?: string;
    summary?: string;
    reason?: string;
    duration?: number;
    test_url?: string;
    result_code?: number | string;
    verdict?: KaneVerdict;
  } | null;
  screenshot: string | null;
  evidencePack?: string;
};

export type WorkAttempt = {
  n: number;
  agentExitCode: number | null;
  summary: string;
  diff: string;
  verdict: string | null;
  detail: string;
};

export type LogSource = 'seyrin' | 'policy' | 'agent' | 'kane';
export type LogEntry = { ts: string; source: LogSource; text: string };

export type Task = {
  id: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  email: { threadId: string; subject: string; from: { name?: string; email: string }; bodyText: string };
  kind: TaskKind;
  ask: string;
  requester: { name?: string; email: string; trust: Trust; role: string | null };
  policy: Policy;
  fixPolicy: Policy | null;
  phase: TaskPhase;
  detail: string;
  spec: Record<string, unknown> | null;
  plan: { steps: PlanStep[]; verify: string | null; target: string | null } | null;
  extractor: string | null;
  app: { id: string; name: string; canFix: boolean } | null;
  run: KaneRun | null;
  runs: KaneRun[];
  work: { agent: string; attempts: WorkAttempt[] } | null;
  result: { verified: boolean; link: string | null; proof: string | null } | null;
  undo: { available: boolean; label: string } | null;
  draftReply: string;
  log: LogEntry[];
};

export type TaskSummary = { id: string; threadId: string; kind?: TaskKind; phase: TaskPhase };

export type HealthApp = { id: string; name: string; origins: string[]; canFix: boolean; fixAgent: string | null; fixReady: boolean };
export type Person = { name?: string; email: string; trust: Trust; role?: string | null };
export type Health = {
  ok: boolean;
  kane: { installed: boolean; version?: string; signedIn?: boolean; fake?: boolean };
  openai: boolean;
  apps: HealthApp[];
  people?: Person[];
};

export type OutgoingEmail = { threadId: string; subject: string; from: { name: string; email: string }; bodyText: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the Seyrin server on :4477. Is `npm start` running?", 0, null);
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

export const api = {
  health: () => call<Health>('GET', '/health'),
  tasks: () => call<{ tasks: Task[] }>('GET', '/v1/tasks'),
  open: (email: OutgoingEmail, rerun = false) => call<Task>('POST', `/v1/tasks${rerun ? '?rerun=1' : ''}`, email),
  approve: (id: string) => call<Task>('POST', `/v1/tasks/${encodeURIComponent(id)}/approve`),
  dismiss: (id: string) => call<Task>('POST', `/v1/tasks/${encodeURIComponent(id)}/dismiss`),
  fix: (id: string) => call<Task>('POST', `/v1/tasks/${encodeURIComponent(id)}/fix`),
  undo: (id: string) => call<Task>('POST', `/v1/tasks/${encodeURIComponent(id)}/undo`),
  editSpec: (id: string, spec: Record<string, unknown>) => call<Task>('PATCH', `/v1/tasks/${encodeURIComponent(id)}`, { spec }),
  evidence: (id: string, attempt?: number) =>
    call<{ viewer: string }>('POST', `/v1/tasks/${encodeURIComponent(id)}/evidence${attempt ? `?attempt=${attempt}` : ''}`),
  reset: () => call<{ ok: boolean }>('POST', '/v1/admin/reset'),
};

export const shotUrl = (file: string) => `/v1/shots/${encodeURIComponent(file)}`;

/** A Task-like response is only trusted when it carries an id and a phase. */
export function isTask(value: unknown): value is Task {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'phase' in value);
}

// ---------------------------------------------------------------------------------------------
// One shared EventSource for /v1/events. The inbox list and the Kane console both listen to it.

type Handler = (data: any) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
const KINDS = ['state', 'log', 'kane', 'gate', 'reset'] as const;
export type EventKind = (typeof KINDS)[number] | 'open' | 'down';

function fire(kind: EventKind, data: unknown) {
  for (const fn of handlers.get(kind) || []) {
    try {
      fn(data);
    } catch (error) {
      console.error(error);
    }
  }
}

function ensureSource() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/v1/events');
  for (const kind of KINDS) {
    source.addEventListener(kind, (event) => {
      let data: unknown = null;
      try {
        data = JSON.parse((event as MessageEvent).data);
      } catch {
        return;
      }
      fire(kind, data);
    });
  }
  source.addEventListener('open', () => fire('open', null));
  source.addEventListener('error', () => fire('down', null));
}

export function onEvent(kind: EventKind, fn: Handler): () => void {
  ensureSource();
  if (!handlers.has(kind)) handlers.set(kind, new Set());
  handlers.get(kind)!.add(fn);
  return () => {
    handlers.get(kind)?.delete(fn);
  };
}

export function eventsLive(): boolean {
  return source?.readyState === 1;
}
