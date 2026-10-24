#!/usr/bin/env node
// Drive the demo inbox through Seyrin's API from a clean reset, approving what a person would approve,
// so the benchmark measures complete runs. Uses the same fixture mail as the inbox app.
// --prepare stops before anything that needs approval, leaving Approve and Fix it for a live demo.
const server = process.env.SEYRIN_URL || 'http://127.0.0.1:4477';
const { FIXTURES } = await import(new URL('../app/src/fixtures.ts', import.meta.url).href);
const post = (path, body) => fetch(`${server}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const get = (path) => fetch(`${server}${path}`).then((r) => r.json());
const settle = async (id, phases) => {
  for (;;) {
    const task = await get(`/v1/tasks/${id}`);
    if (phases.includes(task.phase)) return task;
    await new Promise((r) => setTimeout(r, 2000));
  }
};
const DONE = ['done', 'failed', 'error', 'refused', 'needs_info', 'reproduced', 'not_reproduced', 'awaiting_approval'];

if (!process.argv.includes('--no-reset')) await post('/v1/admin/reset');
for (const mail of FIXTURES) {
  const created = await post('/v1/tasks', { threadId: mail.threadId, subject: mail.subject, from: mail.from, bodyText: mail.bodyText });
  if (created.error) {
    console.log(`${mail.subject}: no task (${created.reason})`);
    continue;
  }
  let task = await settle(created.id, DONE);
  const prepare = process.argv.includes('--prepare');
  if (task.phase === 'awaiting_approval' && !prepare) {
    await post(`/v1/tasks/${task.id}/approve`);
    task = await settle(task.id, ['done', 'failed', 'error']);
  }
  if (task.phase === 'reproduced' && task.app?.canFix && !prepare) {
    await post(`/v1/tasks/${task.id}/fix`);
    task = await settle(task.id, ['done', 'failed', 'error']);
  }
  console.log(`${mail.subject}: ${task.phase}${task.detail ? ` (${task.detail})` : ''}`);
}
