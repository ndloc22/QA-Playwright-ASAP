---
mode: 'agent'
description: 'Create an ASAP Jira test sub-task from the current story with Summary "Test in DEV <issue key>"'
---

# Create ASAP Test Sub-task

When the user calls `/create-test-sub-task`, perform the workflow directly in the shared/current browser tab. Do not only describe the steps.

## Context and Rules

- Use the currently open Jira story in project `Cyber Security Portal (ASAP)` as the parent issue.
- If no Jira story tab is shared, ask the user to share/open the Jira story first.
- Keep the current SSO session. If Jira shows a login page, ask the user to log in manually; never ask for or handle passwords.
- Do not open unrelated new tabs. Prefer operating on the current Jira tab.
- Do not modify source files or Playwright tests for this task.
- Keep default Jira field values unless the user explicitly provides different values.

## Workflow

1. Confirm the current page is a Jira story page, for example `https://jira.eon.com/browse/ASAP-5568`.
2. Read the story key and story title from the page heading.
   - Example observed story key: `ASAP-5568`.
   - Example observed story title: `Replace Chapter with Reference`.
3. Open the `Create Subtask : <story-key>` dialog from the story page.
   - Use Jira's available `Create Subtask` action, normally from the `More` menu or equivalent issue action.
4. In the dialog, verify `Issue Type` is `Sub-task`.
5. Fill `Summary` with exactly:

   ```text
   Test in DEV <issue key>
   ```

   Example:

   ```text
   Test in DEV ASAP-5569
   ```

6. In the `Assignee` field, click the `Assign to me` link so the subtask is assigned to the current user.
7. Leave the other fields as their defaults unless the user specifies otherwise.
   - Observed defaults/notes: Security Level is inherited from the parent; Priority defaults to `None`; Sprint is inherited from the parent; Epic Link cannot be assigned to a subtask.
8. Click `Create`.
9. Verify the dialog closes and Jira returns to the parent story page.
10. Report the created sub-task key and link if Jira displays them. If the key is not visible, report that creation appears complete and include the parent story key and Summary used.

## Recorded Example

- Parent story: `ASAP-5568` - `Replace Chapter with Reference`.
- Created subtask Summary pattern: `Test in DEV ASAP-5568`.
