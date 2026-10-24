# Changelog

Changes are grouped by outcome. Unreleased entries describe changes awaiting release and do not imply a tagged release or deployment.

## Unreleased — 2026-10-24

Make the repository explain Seyrin's real task workflows, verification loop, and local setup with inspectable source links and actual app captures.

### Highlights

| Area | Change | Outcome |
| :--- | :--- | :--- |
| Product presentation | Add a reproduced-bug hero and document/approval capture grid | Visitors can inspect the local inbox workflow before running it. |
| Architecture | Describe policy decisions, agent dispatch, serialized Kane checks, and file persistence | Implementation choices and their limits are visible beside the source. |
| Setup | Separate offline simulation from real browser verification; add a safe environment template | Readers can choose a credential-free walkthrough or configure external services. |

### Documentation & Presentation

- **README:** Replace the text-only overview with UI proof, a Mermaid architecture diagram, a module-level walkthrough, engineering tradeoffs, categorized stack, and repository map.
- **Scope:** Clarify fixture email, local document storage, approval boundaries, imperfect browser verdicts, snapshot limitations, conditional CI verification, and undeclared licensing.
- **Presentation notes:** Record screenshot provenance, exact recapture instructions, suggested GitHub metadata, and remaining owner choices.
- **Benchmark context:** Link retained measurements while distinguishing modeled manual baselines from observations.

### Tooling & Hygiene

- **Configuration:** Add `.env.example` with empty credentials and documented runtime defaults.
- **Ignore rules:** Cover local environment variants, generated Kane output folders, evidence packs, logs, and Python caches. Existing tracked run artifacts and in-progress changes are retained.
- **Documentation checks:** Add the presenter's standard-library validator locally, correcting its parser for `npm ci` and colon-separated script names such as `app:build`.

### Verification proof

- `npm test`: 34 tests passed across 3 files.
- `npm run typecheck`: passed.
- `npm run app:build`: passed.
- `npm run site:build`: passed.
- `python3 scripts/validate_readme.py README.md --strict` and the same check for `CHANGELOG.md`: passed with no errors or warnings.
- **Disposable offline smoke:** a separate temporary copy served the inbox and a generated document, completed a template-written task with the fake Kane adapter, and confirmed OpenAI was disabled. The active demo state was preserved.
- UI captures show existing tasks in the running local app with real Kane configured. No new paid browser runs or provider-backed repairs were performed for this presentation pass.
