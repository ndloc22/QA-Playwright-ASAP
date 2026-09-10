---
name: regenerate
description: Regenerate Playwright spec grounded in real recording, unmark test.fixme, and verify
---

# Command: /regenerate

Update the test spec after recording, binding to real DOM selectors, automatically removing `test.fixme`, and verifying test execution.

## Instructions:
1. Extract the ticket key or function name from user input (e.g. `KFWT-1161`, `SEARCH_TELECONTROL`):
   ```bash
   npm run regenerate <KEY_OR_FUNCTION>
   ```
2. Execute the terminal command.
3. Report test execution status (PASS / FAIL) and suggest reviewing the video report with `/report`.
