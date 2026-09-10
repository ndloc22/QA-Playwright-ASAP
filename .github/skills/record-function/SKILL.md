---
name: record-function
description: Launch live browser codegen recorder to capture a Function/Module flow (Group 2)
---

# Command: /record-function

Launch the Playwright Codegen recorder with pre-authenticated session (`.auth/user.json`) and `BASE_URL` loaded from `.env`. Use this for standalone **Functions/Modules (Group 2)** — no Jira ticket required. To record a **Jira Ticket (Group 1)**, use `/record-ticket` instead.

## Instructions:
1. Extract the function name from user input (UPPER_SNAKE_CASE, e.g. `ADMINISTRATION`, `SEARCH_TELECONTROL`):
   ```bash
   npm run record:function <FUNCTION_NAME>
   ```
2. Execute the command in the terminal.
3. Inform the tester:
   - The browser window is now open with Playwright Recorder.
   - Perform the required actions on the web application.
   - Once finished, **simply close the browser window**. The recording is saved automatically to `tests/recordings/functions/<FUNCTION_NAME>.recording.ts` (grouped, conflict-free).
4. Suggest next step: run `/sync-specs <FUNCTION_NAME>` to generate the Page Object (`tests/pages/functions/<Name>Page.ts` + a backward-compatible proxy) and the starter spec (`tests/e2e/functions/TC-<FUNCTION_NAME>.spec.ts`).
