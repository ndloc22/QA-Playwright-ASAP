---
name: sync-specs
description: Reverse-Ground components and generate Page Object Model + Starter Spec from recording
---

# Command: /sync-specs

Extract live UI components from recording (Reverse-Grounding) and generate/overwrite Page Object Model and Starter Spec.

## Instructions:
1. Extract function name or ticket key from user input (e.g. `ADMINISTRATION`, `SEARCH_TELECONTROL`, `KFWT-1161`):
   - Use 1-click forced overwrite:
   ```bash
   npm run sync-specs:force <KEY_OR_FUNCTION>
   ```
2. Execute the command in the terminal.
3. Summarize generated and updated files:
   - Page Object Model: `tests/pages/<Name>Page.ts`
   - Starter Spec: `tests/e2e/TC-<NAME>.spec.ts`
   - Live Grounded Components: `docs/specs/codebase/live_grounded_components.yaml`
4. Guide the tester on how to run tests:
   > Run: `/test-run TC-<NAME>` or single testcase: `npx playwright test tests/e2e/TC-<NAME>.spec.ts -g "01" --debug`.
