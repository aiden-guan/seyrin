# Seyrin: Submit tab drafts

Paste these into https://kaneclihack.sh/t/seyrin/submit. Edit freely.

**Project name:** Seyrin
**Project type:** Web App

**One-line pitch:**
Agents in your inbox that do what your email asks: write the doc, fix the bug, change the site. Kane CLI proves the work in a real browser before Seyrin replies "done".

**Repository URL:** https://github.com/aiden-guan/seyrin

**Exact commit SHA:** (the 40-character `git rev-parse HEAD` after the last push)

**Live demo URL or run command:**
```
git clone https://github.com/aiden-guan/seyrin && cd seyrin && npm install && npm i -g @testmuai/kane-cli@rc && kane-cli login && echo "OPENAI_API_KEY=sk-…" > .env && npm start   # then open http://127.0.0.1:4477
```

**Problem:**
Founders and small teams run on email. A cofounder asks for a one-pager, a customer reports a broken button, a teammate wants a price changed. Email clients help you reply, but nobody does the work. An AI agent can do it, but an unchecked agent says "done" when it isn't, and an inbox agent is a target for phishing and prompt injection.

**What we built:**
Seyrin reads the requests in an inbox and turns each into a task. It decides who asked (trust) and what the task would change (risk), then runs it, asks first, or refuses. An OpenAI agent writes the document, fixes the code or changes the site. Kane CLI then verifies the result in a real browser: the doc's sections and facts, the customer's exact steps, the changed page. Only a green Kane run lets Seyrin mark the task done and draft the reply with the link and the proof. Passing runs become `_test.md` regression flows.

**How it works (steps):**
1. An email arrives. Seyrin classifies it (document, bug report, site change, or nothing) and extracts the specifics with OpenAI, behind allowlist, credential and prompt-injection filters.
2. Policy: trust (team, known, unknown; impersonation detected) × risk (read, create, modify). The result is run automatically, ask the owner, or refuse. Money and credential requests are always refused.
3. The agent does the work (OpenAI; Claude Code and Codex can plug in).
4. Kane CLI checks it in a browser. A failure goes back to the agent with Kane's verdict and failed step, for up to 3 rounds. A pass marks the task done, drafts the reply and saves a regression flow. Undo and an audit log cover every change.

**4-step harness flow:**
1. **Spec:** the customer's email becomes a Kane objective, e.g. "Go to /pricing, click Upgrade to Pro, verify the page shows the checkout form".
2. **Run:** `kane-cli run … --agent` reproduces it. `run_end` with `result_code 740` means a confirmed product bug.
3. **React:** the OpenAI agent gets Kane's verdict and failed step, patches the code, and Kane re-runs the same steps (max 3 rounds, then escalate to a human).
4. **Keep:** the passing run is saved as a `_test.md` regression flow. The Kane gate replays saved flows as a Claude Code Stop hook, on save (`--watch`), and in CI as a `kane-cli testrun` suite.

**Kane components used:** kane-cli run (--agent NDJSON), _test.md flows (testmd run), testrun suite, evidence packs, bug detection verdicts (result_code 740), Test Manager links, CI, Kane inside the product as the gate/grader for another agent.

**Harness description:**
Seyrin's server is the harness. Each task ends in `kane-cli run --agent`; Seyrin parses the NDJSON live (steps, `run_end`, verdict, `result_code`, `session_dir`), shows the steps, screenshot and evidence pack in the inbox, and uses the verdict to decide Done, Reproduced or Retry. On failure, the agent's next prompt is Kane's verdict, one-liner and failed step. Fixed bugs and changes are saved with `--name` as `_test.md` flows. `gate/kane-gate.mjs` replays them as a Claude Code Stop hook (blocks the agent until green, escalates after 3), on every save, and in CI with `kane-cli testrun`. `gate/spec-to-flows.mjs` compiles a markdown spec into flows.

**Measured impact:** (from bench/comparison.md; human times are modeled from published rates, Seyrin times are measured)
Five inbox tasks would take a person about 88 min by hand. Seyrin finished them in 6.1 min of machine time, with about 2.5 min of the owner's attention (97% less). Every result was verified by Kane before it was called done. Kane caught a real environment bug during the build: the dev server was serving a stale copy, so fixes looked failed until the page actually changed. The benchmark also exposed an extraction bug: the reporter's `+` email was being generalised away, and Kane correctly reported "not reproduced" until we fixed it.

**Known limitations:**
- A demo inbox with fictional mail; no Gmail connection yet.
- Documents land in Seyrin Docs on this computer, not Google Docs.
- Kane runs one at a time (30–90 s each).
- The built-in OpenAI coding agent reads the whole app into one prompt, so it suits small apps. Point it at Claude Code or Codex for large repos.
- `kanehack report` (0.1.24) doesn't count `kane-cli run` reports with Kane 0.10.0-rc.3 (a `coverage` event precedes `run_end`), so the recorded runs use `testmd run` and `testrun`.
