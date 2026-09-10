# 🧪 QA Playwright Copilot Starter Kit

### E2E Testing Starter Kit — **Testcase-First** Architecture + GitHub Copilot

> From a single ticket key → a complete testcase + Playwright spec, **grounded in the real DOM** (no selector guessing), run **1-Click**, and self-diagnosing on failure — all optimized for AI token cost.

<p align="left">
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="GitHub Copilot" src="https://img.shields.io/badge/GitHub%20Copilot-000000?logo=githubcopilot&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js%2020%2B-339933?logo=node.js&logoColor=white">
</p>

> 💡 An E2E test-automation project tailored for the **ASAP** team. The default ticket format is `ASAP-<ID>` (e.g. `ASAP-101`); point `BASE_URL` at the ASAP test server and you are ready to go.

> 🌐 This is the **English** version. 🇻🇳 Vietnamese original: [`../README.md`](../README.md).

---

## 🚀 Quick Start — The Standard 3-Step QA Workflow

After [installing](#-installation) and [configuring `.env`](#-environment-setup), each ticket needs just 3 commands:

```bash
# 1️⃣ Generate testcase & spec from a ticket (fetch → summarize → analyze → generate → verify)
npm run auto-test ASAP-101

# 2️⃣ Open the real app, click through the main flow, close the window → auto-export the recording
npm run record:ticket ASAP-101

# 3️⃣ Regenerate: reference the recording, remove test.fixme, sync OpenSpecs & verify the test
npm run regenerate ASAP-101
```

| Step | Command | Output |
| :-: | --- | --- |
| 1 | `npm run auto-test <KEY>` | `tests/testcases/TC-<KEY>.md` + `tests/e2e/TC-<KEY>.spec.ts` |
| 2 | `npm run record:ticket <KEY>` | `tests/recordings/<KEY>.recording.ts` (real DOM/selectors) |
| 3 | `npm run regenerate <KEY>` | Spec bound to real selectors, `test.fixme` removed, OpenSpecs updated |

> 💡 You can pass a ticket URL instead of `<KEY>`: `npm run auto-test https://your-jira/browse/ASAP-101`.

---

## 📋 Command Cheatsheet

| Command | Purpose |
| --- | --- |
| `npm run auto-test <KEY>` | 4-step pipeline: fetch ticket → summarize → analyze + generate → verify (add `-- --create-subtask` to also create a Jira Test Sub-task at 0 tokens) |
| `npm run regenerate <KEY>` | Regenerate the spec from a recording (skips fetch/summarize), removes `test.fixme` |
| `npm run record:ticket <KEY>` | Open the real app + codegen, record the flow → `tests/recordings/<KEY>.recording.ts` |
| `npm run sync-specs <KEY>` | *(Utility)* Manually merge selectors from a recording into OpenSpecs (runs automatically during regenerate) |
| `npm run fetch-ticket <KEY>` | Extract a ticket (text + images + diagrams) into `docs/tickets/` |
| `npm run create-subtask <KEY> [KEY2 ...]` | **(0 tokens)** Create a Jira Test Sub-task `Test in DEV <KEY>` (assigned to me) via pure Playwright over REST API — supports **multi-ticket** (parallel, single SSO login) — replaces the `/create-test-sub-task` AI prompt |
| `npm test` | Run the whole suite (headless) |
| `npm run test:headed` | Run tests with the browser visible |
| `npm run test:ui` | Open Playwright UI Mode (time-travel, visual debug) |
| `npm run test:debug` | Run tests in debug mode |
| `npm run report` | Open the HTML report of the last run |
| `npm run generate-codebase-specs` | Extract OpenSpecs from the application source (if available) |

> Run a specific file: `npx playwright test tests/e2e/TC-ASAP-101.spec.ts`.
> In VSCode: press **`F5`** or open the 🧪 **Testing** tab → ▶️ Play button.

---

## 🧰 Installation

```bash
git clone https://github.com/ndloc22/QA-Playwright-ASAP.git
cd QA-Playwright-ASAP
```

Then run the automated setup:
- **🪟 Windows:** double-click **`setup-tester.bat`**
- **🍎 macOS / 🐧 Linux:** `./setup-tester.sh`

---

## 🌐 Environment Setup

Create a `.env` file (see `.env.example`) and point `BASE_URL` at the app you want to test:

```ini
# App under test (default example: TodoMVC demo)
BASE_URL=https://demo.playwright.dev/todomvc

# Login credentials (optional — only if the app requires auth, used for login & recording)
TEST_USERNAME=your_username
TEST_PASSWORD=your_password
```

> The login session is stored in `.auth/user.json` so `record:ticket` enters the already-logged-in app without re-authenticating each time.

---

## 🧠 Smart Architecture (Condensed)

### OpenSpecs + Reverse-Grounding — living, self-learning knowledge

Instead of feeding all business documentation to the AI every time, the starter kit compresses the domain into **OpenSpecs** (YAML) and enriches them from real recordings:

```
   Ticket ──────► fetch-ticket ──► docs/tickets/<KEY>.md (+ images/diagrams)
                                          │
                 OpenSpecs (docs/specs/)  │   ◄── business docs compressed to YAML
                 index • process • roles • fields
                 codebase/ ui_components • state_machine
                                          │
                                          ▼
   ┌────────────────► auto-test ──► TC-<KEY>.spec.ts (with test.fixme)
   │                                      │
   │        record:ticket (real app) ─────┤
   │        recording.ts (DOM/selectors)  │
   │                                      ▼
   │                 regenerate ──► spec bound to real selectors, test.fixme removed
   │                                      │
   └──────── sync-specs (Reverse-Grounding) ◄── merge real selectors
             live_grounded_components.yaml     (priority > static spec)
```

- **Forward:** OpenSpecs → generate tests (grounding).
- **Reverse-Grounding:** the selectors a tester just exercised → merged back into `docs/specs/codebase/live_grounded_components.yaml` → **later tickets immediately reuse** verified selectors (higher priority than the static spec).

> 📐 Deep dive on why this YAML compression is fast, light, and token-efficient: **[CODEBASE_YAML_SPECS_ARCHITECTURE.md](./CODEBASE_YAML_SPECS_ARCHITECTURE.md)**.

### Token optimization — tiered AI models

"Reading/extraction" uses a cheap model; only "reasoning/test design" uses a strong model:

```
[1/4] Ingest ticket    → 0 tokens (scrape DOM)
[2/4] Summarize story  → claude-sonnet-5   (read ticket/images/comments → summary.json)
[3/4] Analyze + New-test → claude-opus-4.8 (resolve conflicts + generate spec, ~30k tokens)
[4/4] Verify test      → 0 tokens (local Playwright)
  └─ on FAIL: self-heal → claude-sonnet-5
```

Downgrade the model for simple tickets: `npm run auto-test <KEY> -- --sonnet` (or `--model claude-sonnet-5`).

### Zero-token Jira Test Sub-task creation — `npm run create-subtask`

The `/create-test-sub-task` prompt (agent mode) makes the AI click through the browser step by step to create a sub-task ⇒ burns tokens. The `scripts/create-subtask.js` script does the same but at **0 tokens**: it reuses the existing SSO session/profile (`.auth/jira-profile`) and calls the Jira REST API (`POST /rest/api/2/issue`) directly in the page context (sharing the login cookies).

```bash
# Create the "Test in DEV ASAP-5568" sub-task (assigned to me) for story ASAP-5568
npm run create-subtask -- ASAP-5568

# Headless (when the SSO session is already valid, good for CI)
npm run create-subtask -- ASAP-5568 --headless

# Override the default Summary (only when exactly 1 ticket is passed)
npm run create-subtask -- ASAP-5568 --summary "Test in DEV ASAP-5569"

# 🆕 Multi-ticket — space-separated (single SSO login, runs in parallel)
npm run create-subtask -- ASAP-101 ASAP-102 ASAP-103

# 🆕 Multi-ticket — comma-separated string
npm run create-subtask -- "ASAP-101, ASAP-102, ASAP-103"

# 🆕 Multi-ticket — read the list from a file (per line/comma/space; '#' is a comment)
npm run create-subtask -- --file tickets.txt

# 🆕 Tune the pool's parallelism (default 3)
npm run create-subtask -- ASAP-101 ASAP-102 ASAP-103 --concurrency 5

# Fold into the auto-test pipeline (create the sub-task right after fetching the ticket)
npm run auto-test ASAP-5568 -- --create-subtask
```

**`create-subtask` flags:**

| Flag / Env var | Meaning |
| --- | --- |
| `<KEY> [KEY2 ...]` | One or more ticket keys (space- or comma-separated) — deduplicated, uppercased, order preserved |
| *(default)* | Headed — opens a Chrome window for first-time SSO/2FA login |
| `--headless` | Run headless when the SSO session is valid (good for CI) |
| `--headed` | Force a visible window (overrides `CREATE_SUBTASK_HEADLESS`) |
| `--summary "<text>"` | Override the default Summary (`Test in DEV <KEY>`) — **only with exactly 1 ticket** |
| `--file <path>` | Read the ticket list from a file (per line/comma/space; lines starting with `#` are comments) |
| `--concurrency <N>` | Number of tickets processed in parallel in the pool (default `3`) |
| `CREATE_SUBTASK_HEADLESS=1` | Equivalent to `--headless` |
| `CREATE_SUBTASK_CONCURRENCY` | Default parallelism (overridden by `--concurrency`) |
| `JIRA_BASE_URL` | Override the Jira domain (default `https://jira.eon.com`) |

Safety characteristics:
- **Multi-ticket (Bounded Concurrency Pool):** the browser starts + SSO authenticates **exactly once**, then sub-tasks are created in parallel via the pool (default 3 workers). **100% backward compatible** when a single ticket is passed.
- **Independent error handling:** a failure on one ticket does **not** affect the others; a **summary table** is printed at the end (Parent ticket / Status: Created · Already exists · Error / Subtask Key / Jira link) with a count line.
- **Idempotent:** if a sub-task with the same Summary already exists, it is skipped, not duplicated.
- **Headed by default** for first-time SSO/2FA; **`--headless`** when the session is valid.
- Assignee = current user (equivalent to "Assign to me"); other fields keep defaults (inherited from the parent story).
- Graceful error handling (not logged in, wrong key, network error) and it **does not block** the existing test-generation/verification flow when run via `--create-subtask`.
- Exit code: `0` if **all** tickets succeed or already exist; `1` if at least one errors out.
- Override the domain via the `JIRA_BASE_URL` env var (default `https://jira.eon.com`).

📖 Full details: **[ADVANCED-GUIDE.md](./ADVANCED-GUIDE.md)**.

---

## 📁 Directory Map

```
QA-Playwright-ASAP/
├── .github/
│   └── prompts/            # Prompt logic: analyze-story, new-test, summarize-story, fix-failed-test, ground-page
├── docs/
│   ├── specs/              # Business OpenSpecs: index/process/roles/fields.yaml (template)
│   │   └── codebase/       # Extracted from source: ui_components, state_machine, live_grounded_components
│   ├── tickets/            # Extracted tickets (<KEY>.md + images/diagrams) — generated at runtime
│   ├── en/                 # 🌐 English documentation (this folder)
│   └── ADVANCED-GUIDE.md   # Detailed advanced mechanics
├── scripts/                # auto-test, fetch-jira, record-ticket, sync-specs, generate-codebase-specs...
├── tests/
│   ├── e2e/                # Playwright specs (TC-<KEY>.spec.ts)
│   ├── pages/              # Page Object Model
│   ├── testcases/          # Testcase descriptions (TC-<KEY>.md) — includes _TEMPLATE.md
│   └── recordings/         # Codegen recordings (<KEY>.recording.ts)
├── .env.example            # Environment config template (BASE_URL, credentials)
├── playwright.config.ts
└── setup-tester.bat / .sh  # 1-click setup
```

---

## 📚 Detailed Documentation

Advanced mechanics live in **[ADVANCED-GUIDE.md](./ADVANCED-GUIDE.md)** to keep this README lean:

1. Spec-Driven Testing — the business OpenSpecs set
2. Ticket extraction (Bookmarklet + Playwright automation + image/diagram download)
3. Grounding & Reverse-Grounding in detail
4. Tiered-model architecture & step-by-step execution via Copilot Chat
5. The Codebase OpenSpecs extractor
6. Blocker & Open Questions workflow (2 phases)
7. Cloning the template to another project

### 🌐 English documentation index

| Document | Description |
| --- | --- |
| [`README.md`](./README.md) | This file — English project overview & 3-step workflow |
| [`ADVANCED-GUIDE.md`](./ADVANCED-GUIDE.md) | End-to-end operational guide for QA engineers & stakeholders |
| [`CODEBASE_YAML_SPECS_ARCHITECTURE.md`](./CODEBASE_YAML_SPECS_ARCHITECTURE.md) | Client-ready whitepaper: why YAML codebase specs are fast, light & token-efficient |
| [`../QA_PLAYWRIGHT_OPTIMIZATION_PLAN_EN.md`](../QA_PLAYWRIGHT_OPTIMIZATION_PLAN_EN.md) | Token-optimization plan & 1-click workflow |

---

## 🔗 References

Open-source projects and architectural references with related paradigms:

- **[OpenSpec (Fission AI)](https://github.com/Fission-AI/OpenSpec)** — Spec-driven AI development kernel & structured YAML specifications for agentic workflows.
- **[Stagehand (Browserbase)](https://github.com/browserbase/stagehand)** — AI-driven web agent framework on top of Playwright with autonomous DOM discovery.
- **[Playwright-BDD](https://github.com/vitalets/playwright-bdd)** — Spec-driven & testcase-first architecture combining behavior specs directly with Playwright.
- **[Microsoft Playwright](https://github.com/microsoft/playwright)** — Core E2E testing framework, Codegen session recorder, and Page Object Model architecture.

