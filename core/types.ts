/** Shared shapes between the Seyrin server and the inbox app. */

export type TaskKind = 'document' | 'bug_report' | 'site_change';

/** How much Seyrin trusts the person asking. Set per person or domain in seyrin.config.json. */
export type Trust = 'team' | 'known' | 'unknown';

/** What the task does to the world, from least to most consequential. */
export type Risk = 'read' | 'create' | 'modify' | 'external';

/** auto: run now (still reversible); approve: wait for the user; refuse: never run. */
export type Decision = 'auto' | 'approve' | 'refuse';

export type TaskPhase =
  | 'understanding'
  | 'awaiting_approval'
  | 'refused'
  | 'needs_info'
  | 'working'
  | 'verifying'
  | 'reproduced'
  | 'not_reproduced'
  | 'done'
  | 'failed'
  | 'error'
  | 'dismissed'
  | 'undone';

export type Email = {
  threadId: string;
  subject: string;
  from: { name?: string; email: string };
  bodyText: string;
  receivedAt?: string;
};

export type Person = { name?: string; email: string; trust: Trust; role?: string };

export type DocumentSpec = { title: string; sections: string[]; audience: string | null; context: string[] };
export type SiteChangeSpec = { url: string | null; change: string; expected: string | null };

export type PlanStep = { label: string; tool: 'docs' | 'kane' | 'code' | 'reply'; risk: Risk };

export type Plan = {
  steps: PlanStep[];
  /** The Kane objective that proves the task is done. Null when nothing can be checked yet. */
  verify: string | null;
  /** Where the work lands: a doc URL, a page, or an app. */
  target: string | null;
};

export type PolicyResult = { decision: Decision; risk: Risk; reasons: string[] };
