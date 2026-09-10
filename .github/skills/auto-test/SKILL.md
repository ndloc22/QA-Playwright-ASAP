---
name: auto-test
description: 4-step automated pipeline from Jira ticket (fetch, summarize, analyze, generate spec, verify)
---

# Command: /auto-test

Execute the automated 4-step Playwright test generation pipeline from a Jira Ticket.

## Instructions:
1. Extract the ticket key (e.g. `KFWT-1161`, `ASAP-101`, `TICKET-123`) or Jira URL from user input.
2. Run the terminal command in the project directory:
   ```bash
   npm run auto-test <KEY>
   ```
   (Pass additional flags such as `--sonnet` or `--create-subtask` if provided by the user).
3. Report the execution summary:
   - Generated testcase: `tests/testcases/TC-<KEY>.md`
   - Generated starter spec: `tests/e2e/TC-<KEY>.spec.ts`
4. Recommend next step to the tester:
   > 💡 Next, open the real application to record the flow:
   > `/record-ticket <KEY>`
