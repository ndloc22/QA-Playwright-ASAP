---
name: create-questionnaire
description: "Create a Questionnaire in the E.ON Cyber Security Portal DEV environment using an Application ID."
---

Create a Questionnaire in the E.ON Cyber Security Portal DEV environment.

Input:
- Application ID: ${input:applicationId:Enter the Application ID}

Procedure:
1. Work in the currently active browser tab and keep the existing DEV session.
2. At the Questionnaire creation screen, click **Search application**.
3. Enter the provided Application ID: `${input:applicationId}`.
4. Search for and select the matching application.
5. If an error is displayed while selecting the application, select the application again and continue.
6. Verify the application details.
7. Submit the task to create the Questionnaire.
8. Confirm that the new task appears in My Tasks as **Complete Questionnaire for <Application ID> - <Application name>**.
9. Open the new **Complete Questionnaire** task.
10. Read and complete the questions in all available tabs, including **Classification**, **Requirements**, and **EAM Information**. Under **Classification**, process the question subtabs such as **Data Privacy**, **Legal/Regulatory**, **Confidentiality**, **Availability**, **Integrity**, **General**, **AI**, and **Result**.
11. When an error is displayed while selecting an answer or application, select the item again and continue.
12. Click **Send to Review** after all required questions are completed.

DEV URL:
https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec

Do not open a new tab for the portal. Report the created task name and any error encountered.
