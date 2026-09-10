---
name: record-ticket
description: Launch live browser codegen recorder to capture a Jira Ticket flow (Group 1)
---

# Command: /record-ticket

Launch the Playwright Codegen recorder with pre-authenticated session (`.auth/user.json`) and `BASE_URL` loaded from `.env`. Use this for **Jira Tickets (Group 1)**. To record a standalone **Function/Module (Group 2)**, use `/record-function` instead.

## Instructions:
1. Extract the ticket key from user input (e.g. `KFWT-1161`):
   ```bash
   npm run record:ticket <KEY>
   ```
2. Execute the command in the terminal.
3. Inform the tester:
   - The browser window is now open with Playwright Recorder.
   - Perform the required actions on the web application.
   - Once finished, **simply close the browser window**. The recording will be saved automatically to `tests/recordings/<KEY>.recording.ts`.
4. Suggest next step: run `/regenerate <KEY>`.
