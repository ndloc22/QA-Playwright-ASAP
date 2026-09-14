# QA-Playwright-ASAP

> **E2E Test Automation for E.ON Axon Ivy CyberSec Portal**
> Powered by Playwright + AI Copilot -- Zero-Friction 1-Command Workflow

A complete automation framework designed so QA Testers can test any Jira ticket or verify a QA deploy with **a single command** -- no need to remember sequences of CLI steps.

---

## Quick Start (First Time)

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. Copy and fill in your environment credentials
cp .env.example .env

# 3. Log in and save your browser session (only once)
npm run login
```

---

## Core Workflows -- 3 Commands Testers Need

### 1. Test a Jira Ticket (Function 1)

```bash
npm run ticket SEC-11359
```

Fully automated pipeline -- tester only interacts with the browser:

| Step | What happens automatically |
|:---:|:---|
| 1 | Fetch story description from Jira -> `docs/tickets/SEC-11359.md` |
| 2 | Open Playwright Codegen browser -- **tester performs the flow**, then closes it |
| 3 | Auto-generate Page Object Model + Test Spec from the recording |
| 4 | Run Playwright test and report **PASS / FAIL** |

**Flags:**
```bash
npm run ticket SEC-11359 -- --skip-fetch    # Use existing ticket .md (offline)
npm run ticket SEC-11359 -- --skip-record   # Use existing recording
npm run ticket SEC-11359 -- --force-record  # Re-record even if recording exists
npm run ticket SEC-11359 -- --headless      # Run verification headless
```

---

### 2. Record a Reusable Business Function (Function 2)

```bash
npm run record:function CREATE_RISK_REQUEST
```

Records a reusable module flow (Create Risk, Create Questionnaire, Create Compliance...).
After the tester closes the browser, the pipeline **automatically**:
1. Generates Page Object (`tests/pages/functions/CreateRiskRequestPage.ts`)
2. Generates Test Spec (`tests/e2e/functions/TC-CREATE_RISK_REQUEST.spec.ts`)
3. Runs a headed verify pass and reports PASS / FAIL

No additional commands required.

**To re-run a recorded function at any time:**
```bash
npm run test:function CREATE_RISK_REQUEST
```

---

### 3. Post-Deploy Smoke Test (Function 3)

```bash
npm run test:post-deploy
```

Run after every QA deploy to verify system health:

**Phase 1 -- Menu & Link Health Check**
- Crawls all top-level navigation menus automatically
- Detects dead links, HTTP errors, PrimeFaces AJAX error dialogs, "View Expired" pages

**Phase 2 -- Core Business Function Verification**
- Runs each function listed in `config/post-deploy-smoke.json` in order
- Reports a full dashboard: menu health + per-function Pass/Fail + total duration

**To configure which functions to verify after deploy**, edit `config/post-deploy-smoke.json`:
```json
{
  "crawlMenus": true,
  "stopOnFailure": false,
  "sequence": [
    "CREATE_RISK_REQUEST",
    "CREATE_QUESTIONNAIRE",
    "CREATE_COMPLIANCE"
  ]
}
```
Add a function name to `sequence` -- no code changes required.

**Aliases:**
```bash
npm run test:smoke          # Same as test:post-deploy
npm run test:post-deploy -- --no-crawl           # Skip menu crawl, run functions only
npm run test:post-deploy -- --stop-on-failure    # Abort on first failure
```

---

## All Available Commands

| Command | Description |
|:---|:---|
| `npm run ticket <KEY>` | **1-command ticket pipeline:** Fetch -> Record -> Sync -> Test -> Report |
| `npm run record:function <NAME>` | Record a reusable function + auto-sync + auto-verify |
| `npm run test:function <NAME>` | Re-run a previously recorded function (headed + SSO hand-off) |
| `npm run test:post-deploy` | Post-deploy smoke suite: menu health + function chain |
| `npm run test:smoke` | Alias for `test:post-deploy` |
| `npm run login` | Save browser session to `.auth/user.json` |
| `npm run login:refresh` | Clear old session and re-login |
| `npm run record:ticket <KEY>` | Open Playwright Codegen for a Jira ticket (record only) |
| `npm run sync-specs <KEY>` | Generate Page Object + Spec from an existing recording |
| `npm run sync-specs:force <KEY>` | Force overwrite existing Page Object + Spec |
| `npm run fetch-ticket <KEY>` | Fetch Jira ticket content to `docs/tickets/` |
| `npm run create-subtask <KEY>` | Create Jira test sub-task via REST API (0 tokens) |
| `npm run auto-test <KEY>` | Full AI pipeline: Jira -> AI generate -> Playwright -> self-heal |
| `npm run regenerate <KEY>` | Re-run AI steps 3+4 only (reuse existing ticket + recording) |
| `npm run test` | Run all tests sequentially (1 worker) |
| `npm run test:headed` | Run all tests with visible browser |
| `npm run test:ui` | Open Playwright UI Mode |
| `npm run test:debug` | Run tests in step-by-step debug mode |
| `npm run report` | Open HTML report |
| `npm run clean` | Remove test-results, playwright-report, blob-report |

---

## Project Structure

```
QA-Playwright-ASAP/
|-- config/
|   `-- post-deploy-smoke.json      # Configure post-deploy function sequence here
|-- docs/
|   |-- specs/                      # OpenSpecs (YAML): business processes, roles, fields
|   |   `-- codebase/               # Extracted from Axon Ivy source: components, state machines
|   `-- tickets/                    # Fetched Jira tickets (<KEY>.md + screenshots)
|-- scripts/
|   |-- ticket-pipeline.js          # [NEW] 1-command ticket wizard
|   |-- post-deploy-smoke.js        # [NEW] Post-deploy smoke runner
|   |-- record-ticket.js            # Playwright Codegen launcher + auto-hook
|   |-- sync-specs.js               # Page Object + Spec generator (Reverse-Grounding)
|   |-- auto-test.js                # AI-powered full pipeline
|   |-- fetch-jira.js               # Jira story extractor
|   |-- run-function.js             # Headed function runner (SSO hand-off)
|   `-- login.js                    # Session saver
|-- tests/
|   |-- e2e/
|   |   |-- functions/              # Reusable function specs (TC-<NAME>.spec.ts)
|   |   `-- smoke/                  # Auto-generated smoke check specs
|   |-- pages/
|   |   `-- functions/              # Page Object Models (<Name>Page.ts)
|   |-- recordings/
|   |   `-- functions/              # Codegen recordings (<NAME>.recording.ts)
|   |-- support/
|   |   `-- menu-crawler.ts         # [NEW] Menu health check utility
|   `-- testcases/                  # Test case descriptions (TC-<KEY>.md)
|-- .env.example                    # Environment variable template
|-- playwright.config.ts
`-- setup-tester.bat                # One-click setup for Windows
```

---

## Environment Variables (`.env`)

```dotenv
BASE_URL=https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec
TEST_USERNAME=your-username
TEST_PASSWORD=your-password
JIRA_BASE_URL=https://your-jira-instance.atlassian.net
JIRA_API_TOKEN=your-api-token
JIRA_USER_EMAIL=your-email@company.com
```

---

## Architecture -- How It Works

```
FUNCTION 1 (Ticket):
  npm run ticket <KEY>
    [1] fetch-jira      ->  docs/tickets/<KEY>.md
    [2] playwright codegen  (tester records in browser)
    [3] sync-specs      ->  Page Object + Test Spec  (auto)
    [4] playwright test ->  PASS / FAIL report       (auto)

FUNCTION 2 (Reusable Module):
  npm run record:function <NAME>
    [1] playwright codegen  (tester records module flow)
    [2] sync-specs      ->  Page Object + Spec       (auto-hook)
    [3] playwright test ->  Verify PASS / FAIL       (auto-hook)
    -> Module is now re-callable: npm run test:function <NAME>

FUNCTION 3 (Post-Deploy Smoke):
  npm run test:post-deploy
    [Phase 1] MenuCrawler  ->  All menus reachable, no errors
    [Phase 2] For each NAME in config/post-deploy-smoke.json:
              playwright test tests/e2e/functions/TC-<NAME>.spec.ts
    [Summary] Dashboard: menu health + per-function Pass/Fail
```

### Grounding & Reverse-Grounding

Selectors are never guessed -- they are **grounded** in real recorded DOM interactions:

- **Forward:** Playwright Codegen records real clicks/fills on the live app.
- **Reverse-Grounding:** `sync-specs` extracts those real selectors back into `docs/specs/codebase/live_grounded_components.yaml`, so future tickets automatically reuse verified selectors.

---

## References

- [Microsoft Playwright](https://github.com/microsoft/playwright) -- E2E testing framework & Codegen
- [OpenSpec (Fission AI)](https://github.com/Fission-AI/OpenSpec) -- Structured YAML spec standard for Agentic workflows
- [Playwright-BDD](https://github.com/vitalets/playwright-bdd) -- BDD spec-driven Playwright integration
- [Stagehand (Browserbase)](https://github.com/browserbase/stagehand) -- AI-powered browser agent on Playwright