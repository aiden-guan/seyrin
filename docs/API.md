# Seyrin server API (local, http://127.0.0.1:4477)

The inbox app is served from the same origin. CORS is open for local tools.

## Task (JSON)

```ts
type Task = {
  id: string; threadId: string; createdAt: string; updatedAt: string;
  email: { threadId: string; subject: string; from: { name?: string; email: string }; bodyText: string };
  kind: 'document' | 'bug_report' | 'site_change';
  ask: string;                      // one line: "Write an Acme Yoga Pilot one-pager"
  requester: { name?: string; email: string; trust: 'team' | 'known' | 'unknown'; role: string | null };
  policy: { decision: 'auto' | 'approve' | 'refuse'; risk: 'read' | 'create' | 'modify' | 'external'; reasons: string[] };
  fixPolicy: Task['policy'] | null; // bug_report only: the policy for "Fix it"
  phase: 'understanding' | 'awaiting_approval' | 'refused' | 'needs_info' | 'working' | 'verifying'
       | 'reproduced' | 'not_reproduced' | 'done' | 'failed' | 'error' | 'dismissed' | 'undone';
  detail: string;                   // one sentence on the current state or result
  spec: object | null;              // document: {title, sections[], audience, context[]}
                                    // site_change: {url, change, expected}; bug_report: {url, steps[], expected, actual, summary, missing[]}
  plan: { steps: { label: string; tool: 'docs' | 'kane' | 'code' | 'reply'; risk: string }[]; verify: string | null; target: string | null } | null;
  extractor: string | null;         // 'openai' | 'heuristic' | ...
  app: { id: string; name: string; canFix: boolean } | null;
  run: KaneRun | null;              // latest Kane run
  runs: KaneRun[];
  work: { agent: string; attempts: { n: number; agentExitCode: number | null; summary: string; diff: string; verdict: string | null; detail: string }[] } | null;
  result: { verified: boolean; link: string | null; proof: string | null } | null;
  undo: { available: boolean; label: string } | null;
  draftReply: string;
  log: { ts: string; source: 'seyrin' | 'policy' | 'agent' | 'kane'; text: string }[];
};

type KaneRun = {
  label: string; attempt: number; objective: string; startedAt: string; endedAt: string | null;
  steps: { step: number; status: 'running' | 'done' | 'failed'; remark: string }[];
  exitCode: number | null;
  runEnd: { status?: 'passed' | 'failed'; one_liner?: string; summary?: string; reason?: string; duration?: number; test_url?: string;
            result_code?: number | string; verdict?: { severity?: string; category?: string; root_cause?: string } } | null;
  screenshot: string | null;        // GET /v1/shots/<screenshot>
  evidencePack?: string;
};
```

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/health` | `{ ok, kane: { installed, version, signedIn, fake }, openai: boolean, apps: [{ id, name, origins, canFix, fixAgent, fixReady }], people: [{ name, email, trust, role }] }` |
| GET | `/v1/tasks` | `{ tasks: Task[] }` |
| GET | `/v1/tasks?threadId=…` | the newest Task for the thread, or 404 |
| POST | `/v1/tasks` | body `{ threadId, subject, from: { name, email }, bodyText }`. Understands the email and applies the policy, then runs it when the decision is `auto`. Returns the Task (202). If the email holds no task, returns `404 { error: 'no_task', reason }`. Idempotent per thread; `?rerun=1` starts over. |
| POST | `/v1/tasks/:id/approve` | runs a task that is `awaiting_approval` |
| POST | `/v1/tasks/:id/dismiss` | |
| POST | `/v1/tasks/:id/fix` | bug_report after `reproduced`: the agent fixes, Kane re-verifies (up to 3 rounds) |
| POST | `/v1/tasks/:id/undo` | deletes the document, or reverts the code change |
| PATCH | `/v1/tasks/:id` | edit the spec (`{ spec: {...} }`) and run again |
| POST | `/v1/tasks/:id/evidence?attempt=n` | `{ viewer }`: a local URL of Kane's evidence viewer |
| GET | `/v1/tasks/:id/stream` | SSE: `state` (Task), `log` (log entry), `kane` (`{ line, label }`, a raw Kane NDJSON line) |
| GET | `/v1/events` | SSE for every task: `state` (`{ id, threadId, kind, phase }`), `log` (`{ id, ...entry }`), `kane` (`{ id, line, label }`), `gate` (Kane gate events), `reset` |
| GET | `/v1/shots/:file` | a screenshot from a Kane evidence pack |
| GET | `/d`, `/d/:slug` | Seyrin Docs: documents Seyrin wrote |
| POST | `/v1/admin/reset` | clears every task and document, and puts the demo app's planted bugs back |
