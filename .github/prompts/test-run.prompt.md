---
name: test-run
description: Execute Playwright E2E tests sequentially, by spec file, or filtered by testcase (-g)
---

# Command: /test-run

Execute Playwright E2E tests based on tester's criteria.

## Instructions:
1. Parse arguments from user input:
   - **All tests sequentially (default)**: `npm test`
   - **Single spec file** (e.g. `TC-ADMINISTRATION`): `npx playwright test tests/e2e/<SPEC>.spec.ts`
   - **Single testcase** (e.g. `-g "01"`): `npx playwright test tests/e2e/<SPEC>.spec.ts -g "01"`
   - **Debug mode step-by-step**: append `--debug`
   - **Interactive UI mode**: `npm run test:ui`
2. Execute command in terminal and present results.
3. Suggest reviewing recorded Full-HD video using: `/report`.
