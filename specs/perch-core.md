---
app: perch
url: http://localhost:4480
repo: demo-app
---

# Perch core flows

What a visitor must always be able to do on Perch. Each criterion compiles to one saved Kane flow
(`demo-app/.testmuai/tests/<flow_name>_test.md`) that the Kane gate replays before an agent may stop.

Compile with `node gate/spec-to-flows.mjs specs/perch-core.md`.

## Acceptance criteria

- home_start_free: Go to /, then click the "Start free" button, then verify the page that opens has the heading "Create your studio"
- signup_basic: Go to /signup, then fill in "Your name" with "Sam Lee", "Email" with "sam@example.com" and "Studio name" with "Clay Corner", then click "Create account", then verify a welcome message naming Sam ("Welcome to Perch, Sam!") is shown
- pricing_plans: Go to /pricing, then verify the page lists three plans with their monthly prices: Free at $0, Pro at $12 and Team at $29

## Not covered yet

Upgrading to a paid plan (checkout) and sign-ups with a "+" in the email address. Those are the
flows customers write in about; PigeonBox turns each report into a new flow.
