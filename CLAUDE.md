# Seyrin: context for agents

Seyrin is Aiden's entry for **Kane CLI Hack Day SF (Sat Oct 24, 2026)**. It is a local web app: agents in your inbox that do what an email asks (write a doc, fix a reported bug, change the website), with **Kane CLI verifying the result in a real browser** before Seyrin calls it done and drafts the reply. Product overview: `README.md`. API: `docs/API.md`. Submit-tab drafts: `docs/submission.md`.

## Hackathon rules that constrain the work (kaneclihack.sh)
- **Fresh code only.** Code written today counts; pre-built projects don't. PigeonBox (Aiden's older Chrome extension, `../pigeonbox`) is pre-built: you may borrow its *ideas and logic*, but **write the code yourself, never copy it**.
- **Gates to place:** the repo is public (github.com/aiden-guan/seyrin, done); OpenAI is used in the build (Seyrin calls the OpenAI API; Aiden also builds in the Codex app); a Kane evidence pack and run report are attached to the submission.
- **Times (PT):** mid-evaluation 2 PM (feedback only); **final scored evaluation 4–5 PM at the table**; content hour 5–6; **submissions lock 6 PM**.
- **Judging:** 4 × 25 points: Kane usage (proof, agent⇄Kane loop, range), idea originality / needs verification, completion (works live, scope honesty, repo quality), GTM (video, deck, blog, posts).
- Kane must be the release candidate (`npm i -g @testmuai/kane-cli@rc`, currently 0.10.0-rc.3). Record runs with `kanehack report -- kane-cli … --agent` (consent given). **Known bug:** kanehack 0.1.24 doesn't count `kane-cli run` reports with rc.3 (a `coverage` event precedes `run_end`), so record via `testmd run` / `testrun` (see `bench/report-runs.mjs`).
- The event's own agent guide is `~/.agents/skills/hack-os/SKILL.md`, and its event API is `node ~/.agents/skills/hack-os/scripts/event-api.mjs call <tool> --args <json file>`. The server says team **Seyrin** is locked (Aiden is captain), activated, and the idea is saved.

## Working with Aiden
- Be factual and concise, cite sources, and say when something is unconfirmed or modeled rather than measured.
- **Ask before starting large work he didn't ask for** (e.g. a whole UI). Don't write demo scripts, decks or posts until he asks; he's doing GTM later.
- **Never handle his secrets.** Keys and passwords go into hidden prompts he runs himself (e.g. `.env` via `read -rs`). Never print `.env` or `~/.kanehack/*`.
- Don't submit, publish, post or make anything public without his yes to the exact content.

## Run it
```bash
npm install && npm start      # Perch (demo product) on :4480, Seyrin on http://127.0.0.1:4477
npm test                      # core unit tests (vitest)
npx vite build app            # inbox app → app/dist (the server serves it)
npm run demo:prepare          # reset + pre-run every demo email; leaves Approve / Fix it for a live demo
npm run bench                 # full benchmark → bench/results.md, bench/comparison.md
npm run report                # record before/after Kane runs on the hack-day Proof tab
npm run gate                  # replay saved Kane flows; npm run suite = kane-cli testrun
```
- **Serve Perch from this folder** (`node demo-app/server.mjs`). An old copy in `../pigeonbox-kane` once served stale files, and every fix looked failed; Kane caught it.
- **Reset demo** (button, or `POST /v1/admin/reset`) restores the planted bugs from the `demo-baseline` tag and deletes `regression_*` / `change_*` flows. Re-tag `demo-baseline` if `demo-app/public` changes on purpose.
- **OpenAI:** the key in `.env` only has access to `gpt-6-luna`; `resolveOpenAIModels()` picks usable models automatically.
- **Evidence packs** contain Aiden's TestMu email, so `evidence/` is gitignored. Never publish a `.evidence` file.

## Layout
- `core/`: pure TS, loaded by the server via Node type stripping.
  - `intent.ts`: request detection and extraction.
  - `safeguards.ts`: trust, risk and the decide policy.
  - `bug-report.ts`: repro specs, Kane objectives and verdicts.
- `server/`
  - `tasks.mjs`: task state machine, plans, code loop, undo, audit.
  - `kane.mjs`: Kane runner, evidence and screenshots.
  - `agents.mjs`: OpenAI, Claude, Codex and custom coding agents, with snapshots for undo.
  - `docs.mjs`: Seyrin Docs.
  - `extract.mjs`: OpenAI extraction.
- `app/`: React inbox (fixtures in `app/src/fixtures.ts`).
- `demo-app/`: Perch, with 2 planted bugs: upgrade buttons read `data-plan-id`; the sign-up email regex rejects `+`.
- `gate/`: Kane gate (Claude Code Stop hook, `--watch`, `--check`, `--loop`) and `spec-to-flows`.
- `bench/`: scenario, measurements, human model (`rates.json`), Proof-tab reporter.
- `site/`: landing page (`npm run site:dev`, `npm run site:build`). `site/art/render-beach.mjs` renders the pixel beach to `site/src/assets`; `site/src/inner.ts` draws the story inside the screen; `stage.ts` is the WebGL compositor. The Open app button points at http://127.0.0.1:4477/ (`VITE_APP_URL` overrides it at build time).

## State (Oct 24, ~12:25 PT)
- All three task types run end to end with real Kane and OpenAI: doc (verified sections and facts), bug report (reproduce → fix → verify → regression flow), and site change (approve → change → verify). Impersonation and money requests are refused.
- **Benchmark:** 5 tasks take about 88 min by hand (modeled) vs 6.1 min for Seyrin (measured), with 2.5 min of owner attention.
- **Proof tab runs** (all verified): KR-57 and KR-59 are Maya's and Dev's flows failing before the fix (defects opened). KR-61 and KR-64 are the same flows passing after Seyrin's fixes. KR-65 is the regression suite passing, and KR-53 is the saved pricing flow passing. Link these on the Submit tab. KR-36 and KR-38 errored because of the kanehack bug; ignore them.
- Perch currently has both fixes applied (uncommitted changes in `demo-app/public`). Run `npm run demo:prepare` to put the bugs back and stage the inbox before judging.
- **Submission paused** at Aiden's request; he has more app work first. When ready: `kanehack submit --preflight`, then link the runs, and he finalizes in the browser.
