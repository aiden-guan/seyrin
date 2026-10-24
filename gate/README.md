# Kane gate

Kane flows are saved browser tests (`<repo>/.testmuai/tests/*_test.md`). The gate replays them with
`kane-cli testmd run <file> --agent --headless` and uses the result to stop a coding agent from
finishing while a flow is red. Plain Node 24 ESM, no dependencies.

Every command picks the Kane binary from `KANE_CLI_BIN` (default `kane-cli`; a `.mjs` path runs with
Node, e.g. `KANE_CLI_BIN=$PWD/scripts/fake-kane-cli.mjs` for offline runs). Every Kane line and gate
decision is appended to `.data/gate.ndjson` (`{ts, source:'gate', kind, run, mode, ...}` with kinds
`gate_start`, `flow_start`, `kane` (`event` = the raw Kane line), `flow_end`, `gate_end`).

## 1. Spec → flows

```bash
node gate/spec-to-flows.mjs specs/perch-core.md --dry-run   # print the compiled objectives and commands
node gate/spec-to-flows.mjs specs/perch-core.md             # run each criterion once with Kane, save flows
node gate/spec-to-flows.mjs specs/perch-core.md --only signup_basic --headed
```

A spec is markdown with frontmatter (`app:`, `url:` base URL, `repo:` relative to this folder) and a
`## Acceptance criteria` list of `- flow_name: objective`. Relative paths (`/pricing`) become absolute
URLs and objectives start with `Go to <url>`. Each criterion runs
`kane-cli run "<objective>" --name <flow_name> --agent --headless --timeout 240 --url <start>` in the
repo, so Kane saves `<repo>/.testmuai/tests/<flow_name>_test.md`. A failing run is reported as
"spec not met"; nothing is deleted.

## 2. Claude Code Stop hook

`demo-app/.claude/settings.json` runs `node "$CLAUDE_PROJECT_DIR/../gate/kane-gate.mjs" --hook`
(timeout 600 s) whenever Claude tries to finish in `demo-app/`:

- no flows, or nothing changed since the last green gate (git diff + status + untracked files +
  flow files; `.testmuai/` ignored) → allow
- all flows pass → allow, `Kane gate: N flows passed`
- a flow fails → `{"decision":"block","reason":...}` listing each failed flow, Kane's reason and the
  failed steps, telling Claude to fix the app code (not the tests or `.testmuai/`) and finish again
- still failing after 3 fix attempts in the session → allow, `Kane gate: still failing after 3 fix
  attempts, needs a human`
- Kane could not run (not logged in, app not reachable) → allow with a note; never blocks on infra

State lives in `<repo>/.testmuai/kane-gate.json` (do not commit it). `KANE_GATE_SKIP=1` disables the
hook; `KANE_GATE_HEADED=1` shows the browser while it replays.

Try it without Claude:

```bash
echo '{"session_id":"t","cwd":"'$PWD/demo-app'"}' | node gate/kane-gate.mjs --hook
```

## 3. Check (CI and by hand)

```bash
node gate/kane-gate.mjs --check demo-app            # exit 0 all green, 1 otherwise
node gate/kane-gate.mjs --check demo-app --headed   # watch the browser
```

Readable progress on stderr, one JSON summary line on stdout. `.github/workflows/kane.yml` runs this
on every push/PR after `kane-cli login` with the `KANE_USERNAME` / `KANE_ACCESS_KEY` secrets.

## 4. Watch ("Kane on every save", any editor)

```bash
node gate/kane-gate.mjs --watch demo-app [--now] [--headed]
```

Watches the repo (ignores `.git`, `.testmuai`, `node_modules`, `.data`), waits 1.5 s after the last
save, replays all flows and prints one line per flow. Runs never overlap; saves during a run queue
one rerun. Press Enter to replay now.

## 5. Fix loop for agents without hooks

```bash
node gate/kane-gate.mjs --loop --agent 'codex exec --full-auto {prompt}' demo-app
node gate/kane-gate.mjs --loop --agent 'claude -p {prompt} --permission-mode acceptEdits' demo-app
```

Replays the flows; on failure substitutes the same feedback prompt (shell-quoted) for `{prompt}`, runs
the agent in the repo with `KANE_GATE_SKIP=1`, and replays again. Up to 3 rounds (`--rounds N`);
exit 0 when green, 1 otherwise.

## Knobs

| env | default | |
| --- | --- | --- |
| `KANE_CLI_BIN` | `kane-cli` | binary or `.mjs` stand-in |
| `KANE_CLI_USER_AGENT` | `claude-code` (hook), agent name (loop) | passed to Kane |
| `KANE_GATE_FLOW_TIMEOUT` | 240 | seconds per flow (`--timeout`) |
| `KANE_GATE_BUDGET_S` | 540 | total seconds the hook may spend (hook timeout is 600) |
| `KANE_GATE_CONCURRENCY` | 1 | flows replayed in parallel |
| `KANE_GATE_TESTMD_ARGS` | | extra `testmd run` args, e.g. `--no-adaptive-heal` |
| `KANE_GATE_NO_PREFLIGHT` | | `1` skips the "is the app reachable" check |
| `KANE_GATE_LOG` | `.data/gate.ndjson` | where gate events go |
