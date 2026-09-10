---
name: record-ticket
description: Launch live browser codegen recorder to capture user flow for a Ticket or Function
---

# Command: /record-ticket

Launch the Playwright Codegen recorder with pre-authenticated session (`.auth/user.json`) and `BASE_URL` loaded from `.env`.

## Instructions:
1. Extract the ticket key or function name from user input (e.g. `KFWT-1161`, `ADMINISTRATION`, `SEARCH_TELECONTROL`):
   ```bash
   npm run record:ticket <KEY_OR_FUNCTION>
   ```
2. Execute the command in the terminal.
3. Inform the tester:
   - The browser window is now open with Playwright Recorder.
   - Perform the required actions on the web application.
   - Once finished, **simply close the browser window**. The recording will be saved automatically to `tests/recordings/<KEY>.recording.ts`.
4. Suggest next step:
   - For Jira Tickets: run `/regenerate <KEY>`
   - For standalone Functions: run `/sync-specs <FUNCTION>`
