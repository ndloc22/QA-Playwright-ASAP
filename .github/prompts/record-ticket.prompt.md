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

## 💡 Recording Tip — Capture Validation Errors Too (for Negative test cases)
The recorder only captures what actually **renders** on screen. A Happy-Path recording never shows any
error message, so the AI has **no grounded locator** for validation errors (TC-02) afterwards.

- **After** completing the Happy Path, if the ticket has any **Validation / required-field** rule,
  record **one extra short pass**: deliberately **leave a required field empty** (or enter an invalid
  value) and click **Submit once**. This makes PrimeFaces render its real error container
  (`p-message` / `.ui-message-error` / `.ui-messages-error`), so the recorder captures the exact
  error selector the AI needs for the Negative test case.
- You don't need to complete a valid submission in this extra pass — just trigger the error, let it
  appear, then close the browser. Both passes are saved into the same recording and used as
  Grounding Truth (see the 3-tier error-locator fallback in `new-test.prompt.md`).

4. Suggest next step: run `npm run qa <KEY>` (or `/regenerate <KEY>`).
