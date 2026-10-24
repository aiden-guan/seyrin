# Repository presentation

## Asset provenance

The README images are unmodified 1280 × 720 PNG screenshots captured from the running local Seyrin inbox on October 24, 2026. They contain fictional fixture messages. The health endpoint identified real Kane, and the captured tasks already had their results before capture. No simulated screenshot, reconstructed UI, or generated product mockup is used.

| File under `assets/readme/` | State shown |
| :--- | :--- |
| `hero.png` | Maya's Upgrade report with a confirmed browser defect; the code fix has not been approved. |
| `document-verified.png` | Jordan's Acme one-pager with a completed Kane check, document link, and undo action. |
| `change-approval.png` | Jordan's proposed $15 Pro price change with a pending approval and browser acceptance objective. |

The captures preserve the app's displayed verdicts. A screenshot is evidence of the displayed state, not an independent correctness assessment of Kane's verdict or a new end-to-end test.

## Recapture checklist

Use a browser content viewport of **1280 × 720 CSS pixels**, without browser or operating-system chrome. Prefer device scale factor **2** when supported for 2560 × 1440 source captures; keep the 16:9 ratio across all three images. The checked-in captures are 1280 × 720 pixels. Collapse the Kane console and scroll the task panel to the top. Keep email content fictional.

| Route | Interaction state | Destination |
| :--- | :--- | :--- |
| `http://127.0.0.1:4477/` | Select “Upgrade button does nothing” after a real Kane reproduction. Show the verdict and fix-approval control; do not approve solely to take the capture. | `assets/readme/hero.png` |
| `http://127.0.0.1:4477/` | Select “One-pager for the Acme Yoga pilot” after verification. Show the sections/facts result and Open the doc action. | `assets/readme/document-verified.png` |
| `http://127.0.0.1:4477/` | Select “Pro price → $15” while awaiting approval. Show the proposed change, approval controls, and planned verification step. | `assets/readme/change-approval.png` |

Reusing existing tasks avoids resetting the demo or spending credits. A fresh staged demo uses `npm run demo:prepare`, which clears existing tasks/documents, restores Perch's planted bugs, and invokes Kane. Never substitute offline stand-in output for browser proof.

For a future short recording, show the Upgrade request, its reproduction evidence, an explicitly approved fix, the re-check, and the final reply draft. Keep waiting periods visibly identified if edited. No recording was created during this pass.

## GitHub surfaces

Suggested About description:

> An inbox agent for documents, bug reports, and approved code changes, with Kane CLI browser checks and evidence.

Suggested topics: `ai-agent`, `email-workflow`, `browser-testing`, `typescript`, `react`, `nodejs`, `kane-cli`, `hackathon`.

No hosted demo was verified during this pass. The landing page's Open app action defaults to a local URL; a static landing-page build does not deploy the backend. Keep the GitHub website field empty until a usable destination has been verified.

For an optional social preview, export a 1280 × 640 PNG under 1 MB with the Seyrin name, a one-line description, and a cropped portion of the real bug-report capture. Upload it through repository settings after review. GitHub metadata, social preview, and repository settings were not changed by the presentation pass.

## Remaining owner choices

- **License:** the repository has no license declaration. Choose terms before adding a license file; the presentation does not infer a license from public visibility.
- **Existing generated output:** Kane output folders already tracked in Git contain in-progress changes in this checkout. They were retained; the new ignore rules prevent additional untracked run outputs from appearing. Review untracking existing outputs separately from the saved `_test.md` flows.
- **CI browser checks:** the workflow only runs Kane when its configured repository credentials are present. Credential and remote-run status were not inspected.

## Local validation

The presentation pass ran the existing unit suite (34 passing tests), TypeScript checking, the inbox build, and the landing-page build. Documentation links, script names, environment references, and image files are checked with `scripts/validate_readme.py --strict`, adapted from the presenter skill with its npm-command parser corrected for `npm ci` and colon-separated script names. Provider calls, a fresh Kane browser run, remote CI, and deployment are separate checks.

A disposable offline smoke check also started the backend in a temporary copy with the empty environment template and fake Kane adapter. The inbox and generated document returned HTTP 200; a team document request completed using heuristic extraction and the template writer, with OpenAI disabled. This verifies the local simulation path, not real browser verification. The running demo was not reset.
