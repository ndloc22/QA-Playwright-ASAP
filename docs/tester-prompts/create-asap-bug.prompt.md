---
name: "Create ASAP Bug"
description: "Create an ASAP Jira bug with the agreed Bug template, backlog sprint, and user-provided priority and epic"
argument-hint: "Title and reproduction details"
agent: "agent"
---

Create a Jira issue in project `Cyber Security Portal (ASAP)` using the information in the user's request.

Use these defaults unless the user explicitly overrides them:
- Issue Type: `Bug`
- Sprint: `Backlog` (leave the Sprint field unassigned if Jira represents Backlog as no active sprint)
- Template: `Template Bug for ASAP`

Set the Summary from the user's title.

Require the user to provide a `Priority`. Accept only: `Critical`, `High`, `Medium`, `Low`, or `None`. Before creating the issue, select and verify the requested priority.

Require the user to provide an `Epic Link`. Before creating the issue, select and verify the matching Jira epic. Do not assume a default epic.

Use the template's description table and populate these rows from the user's report:
- `What ?`: Copy the bug title/Summary exactly. Do not ask the user for a separate `What ?` description.
- `How (to reproduce the bug)`
- `Where?`
- `When?`

Before creating the issue, verify the visible field values. After creation, report the Jira key and link. If screenshot/image files are supplied with the request, attach them and verify they appear on the issue.
