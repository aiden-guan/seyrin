# Seyrin

**Agents in your inbox that do the work, and prove it.**

Email clients help you reply. They don't get anything done. Seyrin reads the requests in your inbox and acts on them:
- **A document:** your cofounder asks for "a one-pager for the Acme pilot".
- **A bug report:** a customer writes that "the Upgrade button does nothing".
- **A site change:** a teammate asks you to "change the Pro price to $15".

An OpenAI agent does the work. Then **Kane CLI checks the result in a real browser** before Seyrin tells you it's done and drafts the reply, with the link and Kane's proof.

An agent that says "done" without checking is how broken work gets shipped. An agent in your inbox is also an easy target for phishing. Seyrin is built around both problems.

## How a request flows

```
email ─▶ understand (OpenAI or heuristics) ─▶ who asked? (trust) · what would it change? (risk)
                                               │
                         refuse ◀──────────────┼──────────────▶ ask you first ──▶ approve
                                               ▼                                     │
                                      run automatically ◀────────────────────────────┘
                                               │
                agent does the work (writes the doc · fixes the code · changes the site)
                                               │
                Kane CLI verifies in a browser ─┬─ green ▶ Done & verified · reply drafted · undo kept
                                                └─ red   ▶ Kane's failure goes back to the agent (≤ 3 rounds) ▶ else: needs you
```

| Request | Kane checks | When Kane says no |
|---|---|---|
| **Write a document** | The doc is up, every requested section has content, and the facts from the email are stated (e.g. "3 studios", "Nov 15", "$12") | The writer gets Kane's finding and rewrites |
| **Bug report** | Kane follows the customer's own steps; `result_code 740` means a confirmed product bug | **Reproduced**. Fix it (asks you first): the agent patches the code and Kane re-runs the customer's steps. The passing run is saved as a `_test.md` regression test |
| **Site change** | The page shows the change ("the Pro plan shows $15") | Kane's failure goes back to the coding agent |

## Safeguards

- **Trust per sender** (`seyrin.config.json`): your team, people you know, everyone else. A stranger using a teammate's name is treated as impersonation and refused.
- **Risk per task:** read-only, creates something private, changes code or your site, external. Reading and private docs for your team run automatically; anything that changes code waits for your approval; site changes only come from your team.
- **Never:** money, bank details, gift cards, credentials or personal data. These are refused whoever asks.
- **Email is data.** Prompt-injection lines ("ignore previous instructions…") never become steps, and they force an approval. Kane only opens origins you registered, so links elsewhere are named and skipped. Model output goes through the same filters as heuristics.
- **Nothing is sent.** Replies are drafts.
- **Undo** deletes the document, or restores the code from a snapshot. Every decision and action is written to `.data/audit.ndjson` and shown in the app.

## Run it

```bash
npm install
npm i -g @testmuai/kane-cli@rc && kane-cli login
echo "OPENAI_API_KEY=sk-…" > .env          # OpenAI writes docs, extracts steps and fixes code
npm start                                  # Perch on :4480, Seyrin on http://127.0.0.1:4477
```

`npm run start:offline` uses `scripts/fake-kane-cli.mjs`, a stand-in that emits Kane's NDJSON, so you can work without credits. `npm run demo:reset` puts Perch's planted bugs back and clears tasks. `npm test` runs the core tests.

## Kane CLI in Seyrin

- **Kane as the judge inside the product.** Every task ends in a `kane-cli run --agent` whose `run_end` decides Done, Reproduced or Retry (`server/kane.mjs`, `server/tasks.mjs`). Evidence packs are kept, and the screenshot and Test Manager link appear in the app.
- **The agent and Kane talk.** Kane's failure (verdict, one-liner, failed step) is the agent's next prompt, for up to 3 rounds (`codeLoop`, `doDocument`).
- **Saved flows and a gate.** Fixed bugs and site changes become `_test.md` regression flows. `gate/kane-gate.mjs` replays them:
  - as a Claude Code **Stop hook** (`demo-app/.claude/settings.json`)
  - on every save (`--watch`)
  - in **CI** (`.github/workflows/kane.yml`)
  - as a fix loop for any agent (`--loop --agent 'codex exec --full-auto {prompt}'`)
- **Specs compile into flows.** `node gate/spec-to-flows.mjs specs/perch-core.md`.
- **Run reports.** With `KANEHACK_REPORT=1`, every run goes through `kanehack report`.

## Layout

- `core/`: request detection, the trust and risk policy, injection and credential filters, Kane objectives, and replies. Pure TypeScript with tests; the server loads it directly.
- `server/`: the HTTP and SSE API (`docs/API.md`), tasks, Seyrin Docs, the Kane runner, and the coding agents (OpenAI, Claude Code, Codex, or any command).
- `app/`: the inbox (React).
- `site/`: the landing page (Vite, TypeScript and WebGL). `npm run site:dev` serves it and `npm run site:build` writes `site/dist`. Its top-right Open app button goes to the inbox at http://127.0.0.1:4477/. The pixel beach comes from `site/art/render-beach.mjs` (`npm run site:art`).
- `demo-app/`: Perch, the fictional booking product the demo mail is about. It has two planted bugs.
- `gate/`, `specs/`, `.github/`: the Kane gate, the specs and CI.

## Limitations

- The inbox is a demo inbox with fictional mail. There is no Gmail connection in this build.
- Documents land in Seyrin Docs on this computer, not Google Docs.
- Kane runs one at a time, and a run takes 30–90 s.
- The built-in OpenAI coding agent suits small apps like Perch (it reads the whole app into one prompt). Point `fixAgent` at Claude Code or Codex for real repositories.
