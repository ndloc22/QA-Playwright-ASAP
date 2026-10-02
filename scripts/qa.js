/**
 * ⚡ E.ON QA Wizard — Record-First / Grounding-First 1-Command Orchestrator
 *
 * A single door for the whole ticket-testing lifecycle. Instead of asking the
 * Tester to remember `auto-test` vs `ticket` vs `record:ticket` + `regenerate`,
 * this wizard runs the unified "Record-First" flow described in
 * docs/analysis/COPILOT_ANALYSIS_RECORD_FIRST.md:
 *
 *   npm run qa <KEY>          # e.g. npm run qa SEC-11359
 *
 * Pipeline (8 steps):
 *   [1] Ingest story from Jira (fetch-jira.js)           -> docs/tickets/<KEY>.md   [0 token]
 *   [2] Summarize story (/summarize-story)               -> <KEY>.summary.json      [sonnet]
 *   [3] Blocker Gate (/analyze-story)                    -> stop+questionnaire(exit 2) if blocked [opus]
 *   [4] Feature LIVE check                               -> live? record : AI-draft(test.fixme)
 *   [5] RECORD real flow (record-ticket.js)              -> <KEY>.recording.ts       (Tester ~1 min)
 *   [6] sync-specs.js (Page Object + reverse-ground)     -> tests/pages/<Feature>Page.ts + live_grounded_components.yaml
 *   [7] AI Test Matrix (/new-test, GROUNDED, reuse POM)  -> TC-<KEY>.md + TC-<KEY>.spec.ts   [opus]
 *   [8] Playwright run -> on fail: ai-healer.js          -> First-Time Green
 *
 * Flags:
 *   --skip-fetch     Skip Jira fetch (use existing docs/tickets/<KEY>.md)
 *   --force-fetch    Force re-fetch from Jira even if the .md already exists
 *   --skip-record    Skip recording (use existing recording / grounding)
 *   --force-record   Force re-record even if a recording already exists
 *   --headed         Run the Playwright verification headed (default: headless)
 *   --ci             Non-interactive mode (no recorder, no prompts) for pipelines
 *   --draft          Force AI-draft mode (wrap every TC in test.fixme), no record
 *   --sonnet         Run Step 3/7 on claude-sonnet-5 instead of the opus default
 *   --model <name>   Run Step 3/7 on an explicit model tier
 *
 * Windows-safety: `.cmd`/`.bat` shims (npx.cmd, copilot.cmd) are invoked with
 * shell:true and a manually quoted command line to sidestep Node's buggy
 * internal .cmd handling (EINVAL / CVE-2024-27980); long prompts are written to
 * a temp file rather than passed as CLI arguments (cmd.exe ~8191 char limit).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const readline = require('readline');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

// Reverse-grounding + Page Object packaging live in sync-specs.js. Requiring it
// only imports the API (its CLI main() runs only when invoked directly).
const { syncKey, toPascalCasePageName, LIVE_SPEC_REL } = require('./sync-specs');

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT_DIR, 'tests', 'recordings');
const AUTH_STORAGE_STATE = path.join(ROOT_DIR, '.auth', 'user.json');

// ── Model tiering (mirrors auto-test.js; overridable via env for experiments) ──
const MODEL_SUMMARY = process.env.AUTO_TEST_SUMMARY_MODEL || 'claude-sonnet-5';
const MODEL_SELF_HEAL = process.env.AUTO_TEST_SELF_HEAL_MODEL || 'claude-sonnet-5';

// ───────────────────────────── CLI helpers ─────────────────────────────

function quoteForCmd(value) {
  const str = String(value);
  if (str === '') return '""';
  if (!/[\s"&|<>^%!]/.test(str)) return str;
  return `"${str.replace(/"/g, '\\"')}"`;
}

function safeSpawnSync(command, args, options = {}) {
  if (IS_WINDOWS) {
    const commandLine = [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ');
    return spawnSync(commandLine, { ...options, shell: true });
  }
  return spawnSync(command, args, { ...options, shell: false });
}

function resolveWindowsBinary(command) {
  if (!IS_WINDOWS) return command;
  const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) return `${command}${ext}`;
    }
  }
  return command;
}

function printHeader(title) {
  const line = '='.repeat(58);
  console.log(`\n${line}`);
  console.log(` ${title}`);
  console.log(`${line}`);
}

function fail(message, code = 1) {
  console.error(`\n\x1b[31m❌ ${message}\x1b[0m\n`);
  process.exit(code);
}

/** Run a bundled node script (never a .cmd/.bat shim -> shell:false is safe). */
function runNodeScript(scriptName, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(__dirname, scriptName), ...args], {
    stdio: 'inherit',
    shell: false,
    cwd: ROOT_DIR,
    env: { ...process.env, ...extraEnv },
  });
}

/**
 * Invoke the Copilot CLI non-interactively with a prompt + pinned model tier.
 * The prompt is written to a temp file (never a raw CLI arg) to sidestep the
 * Node .cmd/.bat EINVAL issue and cmd.exe's ~8191 char command-line limit.
 * Returns { error, status, output }; never throws; always cleans the temp file.
 */
function runCopilotPrompt(promptText, { model, tmpFileSuffix }) {
  const tmpPromptPath = path.join(ROOT_DIR, `.tmp-copilot-prompt-${tmpFileSuffix}.txt`);
  fs.writeFileSync(tmpPromptPath, promptText, 'utf-8');

  const shortInstruction =
    `Read the file ${path.relative(ROOT_DIR, tmpPromptPath).replace(/\\/g, '/')} in the current working directory ` +
    `and carry out ALL instructions written in it exactly, then generate/update the files it specifies.`;

  console.log(`   🧠 Model: ${model}`);
  console.log(`   📄 Full prompt written to: ${path.relative(ROOT_DIR, tmpPromptPath)}`);

  const copilotBin = resolveWindowsBinary('copilot');
  const copilotResult = safeSpawnSync(copilotBin, ['-p', shortInstruction, '--model', model, '--allow-all'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: ROOT_DIR,
    encoding: 'utf-8',
  });

  const copilotStdout = copilotResult.stdout || '';
  const copilotStderr = copilotResult.stderr || '';
  if (copilotStdout) process.stdout.write(copilotStdout);
  if (copilotStderr) process.stderr.write(copilotStderr);

  fs.rmSync(tmpPromptPath, { force: true });

  return {
    error: copilotResult.error,
    status: copilotResult.status,
    output: `${copilotStdout}\n${copilotStderr}`,
  };
}

// ── Blocker detection (mirrors auto-test.js Blocker & Open Questions SOP) ──
const BLOCKER_MARKERS = [
  /open questions?\s*&\s*blockers/i,
  /blocker/i,
  /st[oó]ry\s*b[iị]\s*ch[aặ]n/i,
  /b[aả]ng\s*c[aâ]u\s*h[oỏ]i/i,
  /clear gate/i,
];

function textLooksLikeBlocker(text) {
  if (!text) return false;
  return BLOCKER_MARKERS.some((re) => re.test(text));
}

function detectBlocker(key, copilotOutput) {
  const ticketMdPath = path.join(ROOT_DIR, 'docs', 'tickets', `${key}.md`);
  if (fs.existsSync(ticketMdPath)) {
    try {
      if (textLooksLikeBlocker(fs.readFileSync(ticketMdPath, 'utf-8'))) return true;
    } catch (_) {}
  }
  return textLooksLikeBlocker(copilotOutput);
}

// ── Recording classification (mirrors auto-test.js recordingHasRealInteractions) ──
function recordingHasRealInteractions(content) {
  if (!content) return false;
  const INTERACTION_RE =
    /\.(click|fill|press|check|uncheck|selectOption|setInputFiles|type|dblclick|tap|hover|dragTo|focus)\s*\(|getBy(Role|Label|Placeholder|Text|TestId|Title|AltText)\s*\(/;
  return INTERACTION_RE.test(content);
}

/** Classify a recording without side effects: 'missing' | 'empty' | 'ok'. */
function readRecording(recordingFullPath) {
  if (!fs.existsSync(recordingFullPath)) return { status: 'missing' };
  const raw = fs.readFileSync(recordingFullPath, 'utf-8');
  if (!recordingHasRealInteractions(raw)) return { status: 'empty' };
  const MAX_RECORDING_CHARS = 40000;
  const truncated = raw.length > MAX_RECORDING_CHARS;
  return { status: 'ok', content: truncated ? raw.slice(0, MAX_RECORDING_CHARS) : raw, truncated };
}

// ── Interactive prompt (auto-resolves in --ci / non-TTY) ──
function askChoice(question, choices, fallback) {
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !FLAGS.ci;
  if (!interactive) return Promise.resolve(fallback);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const picked = String(answer || '').trim().toUpperCase();
      resolve(choices.includes(picked) ? picked : fallback);
    });
  });
}

/**
 * Best-effort reachability probe of BASE_URL (Step 4). This confirms the test
 * server responds; it is NOT proof the specific feature is deployed (only the
 * Tester recording / analyze-story can prove that). Non-fatal: returns null on
 * any error so the wizard degrades to interactive/CI decisioning.
 */
function probeBaseUrl(timeoutMs = 6000) {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    try {
      const lib = baseUrl.startsWith('https') ? https : http;
      const req = lib.get(baseUrl, { timeout: timeoutMs }, (res) => {
        res.resume();
        done(res.statusCode != null && res.statusCode < 500);
      });
      req.on('timeout', () => {
        req.destroy();
        done(null);
      });
      req.on('error', () => done(null));
    } catch (_) {
      done(null);
    }
  });
}

// ───────────────────────────── Argument parsing ─────────────────────────────

function parseKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim().split(/[?#]/)[0].replace(/\/+$/, '');
  if (!value) return null;
  const segment = value.split('/').pop();
  const jira = segment.match(/([A-Z][A-Z0-9]*-\d+)/i);
  if (jira) return jira[1].toUpperCase();
  const custom = segment.match(/([A-Za-z0-9_-]+)/);
  return custom ? custom[1].toUpperCase() : null;
}

function resolveModelFromArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sonnet') return 'claude-sonnet-5';
    if (argv[i] === '--model' && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith('--model=')) return argv[i].slice('--model='.length);
  }
  return null;
}

const rawArgs = process.argv.slice(2);
const modelValueIdx = rawArgs.findIndex((a) => a === '--model') + 1;
const positional = rawArgs.find(
  (a, idx) => !a.startsWith('--') && idx !== modelValueIdx && parseKey(a) !== null
);
const KEY = parseKey(positional);

const FLAGS = {
  skipFetch: rawArgs.includes('--skip-fetch'),
  forceFetch: rawArgs.includes('--force-fetch'),
  skipRecord: rawArgs.includes('--skip-record'),
  forceRecord: rawArgs.includes('--force-record'),
  headed: rawArgs.includes('--headed'),
  ci: rawArgs.includes('--ci'),
  draft: rawArgs.includes('--draft'),
};

const MODEL_ANALYSIS =
  resolveModelFromArgs(rawArgs) || process.env.AUTO_TEST_ANALYSIS_MODEL || 'claude-opus-4.8';

function printUsage() {
  console.log('\n\x1b[33m⚡ Usage: npm run qa <TICKET_KEY_OR_URL> [flags]\x1b[0m');
  console.log('   Example: npm run qa SEC-11359');
  console.log('            npm run qa https://your-jira/browse/SEC-11359');
  console.log('\n\x1b[33mFlags:\x1b[0m');
  console.log('   --skip-fetch     Use existing docs/tickets/<KEY>.md (no Jira fetch)');
  console.log('   --force-fetch    Re-fetch from Jira even if the .md already exists');
  console.log('   --skip-record    Use existing recording/grounding (no recorder)');
  console.log('   --force-record   Re-record even if a recording already exists');
  console.log('   --headed         Run the Playwright verification headed');
  console.log('   --ci             Non-interactive pipeline mode (no recorder/prompts)');
  console.log('   --draft          Force AI-draft mode (test.fixme guards, no record)');
  console.log('   --sonnet         Run Step 3/7 on claude-sonnet-5');
  console.log('   --model <name>   Run Step 3/7 on an explicit model tier\n');
}

if (!KEY) {
  printUsage();
  process.exit(1);
}

// ── Per-key paths ──
const ticketMdPath = path.join(ROOT_DIR, 'docs', 'tickets', `${KEY}.md`);
const summaryFullPath = path.join(ROOT_DIR, 'docs', 'tickets', `${KEY}.summary.json`);
const summaryRel = `docs/tickets/${KEY}.summary.json`;
const recordingFullPath = path.join(RECORDINGS_DIR, `${KEY}.recording.ts`);
const recordingRel = `tests/recordings/${KEY}.recording.ts`;
const pageClass = toPascalCasePageName(KEY);
const pomRel = `tests/pages/${pageClass}.ts`;
const pomFullPath = path.join(ROOT_DIR, 'tests', 'pages', `${pageClass}.ts`);
const specRel = `tests/e2e/TC-${KEY}.spec.ts`;
const specFullPath = path.join(ROOT_DIR, 'tests', 'e2e', `TC-${KEY}.spec.ts`);

// ───────────────────────────── Steps ─────────────────────────────

// [1] Ingest story from Jira -------------------------------------------------
function stepFetch() {
  console.log(`\n\x1b[1m[1/8] 📥 Ingesting Jira story for ${KEY}...\x1b[0m`);
  const shouldFetch = !FLAGS.skipFetch && (FLAGS.forceFetch || !fs.existsSync(ticketMdPath));
  if (!shouldFetch) {
    if (fs.existsSync(ticketMdPath)) {
      console.log(`   ↩️  Reusing existing docs/tickets/${KEY}.md (use --force-fetch to refresh).`);
      return;
    }
    fail(
      `--skip-fetch was given but docs/tickets/${KEY}.md does not exist.\n` +
      `   -> Fetch it first: npm run fetch-ticket -- ${KEY}`
    );
  }
  const result = runNodeScript('fetch-jira.js', [KEY]);
  if (result.error || result.status !== 0) {
    fail(
      `Step 1 (Fetch Jira) failed (exit ${result.status ?? 'N/A'}).\n` +
      `   -> Check your Jira session/credentials in .env, then retry.`
    );
  }
  if (!fs.existsSync(ticketMdPath)) {
    fail(`Step 1 reported success but docs/tickets/${KEY}.md was not created.`);
  }
  console.log(`\x1b[32m✅ Story saved: docs/tickets/${KEY}.md\x1b[0m`);
}

// [2] Summarize story (non-fatal) -------------------------------------------
function stepSummarize() {
  console.log(`\n\x1b[1m[2/8] 🧾 Summarizing story (images, comments, codebase grounding)...\x1b[0m`);
  const prompt = `You are executing the "summarize" step of the Record-First automated test pipeline for ticket ${KEY}.

Source ticket: docs/tickets/${KEY}.md
Associated media: docs/tickets/${KEY}/attachments/ and docs/tickets/${KEY}/screenshots/ (if any)
Grounding sources (priority order): docs/specs/codebase/live_grounded_components.yaml (reverse-grounded live selectors, HIGHEST priority when present), then docs/specs/codebase/ui_components.yaml and docs/specs/codebase/state_machine.yaml

Instructions:
1. Follow .github/prompts/summarize-story.prompt.md exactly.
2. Write the condensed, structured summary to exactly: ${summaryRel}
3. Do NOT classify Blocker/Warning and do NOT generate any testcase/.spec.ts file in this step.

Generate or update this file now.`;

  const result = runCopilotPrompt(prompt, { model: MODEL_SUMMARY, tmpFileSuffix: `summarize-${KEY}` });
  if (result.error || result.status !== 0 || !fs.existsSync(summaryFullPath)) {
    console.warn(`\x1b[33m⚠️  Step 2 (Summarize) did not produce ${summaryRel}. Step 3 will read raw sources (costs more tokens, still works).\x1b[0m`);
    return null;
  }
  console.log(`\x1b[32m✅ Summary generated: ${summaryRel}\x1b[0m`);
  return summaryRel;
}

// [3] Blocker Gate (/analyze-story) — stop early if the story is blocked -----
function stepBlockerGate(summaryRelPath) {
  console.log(`\n\x1b[1m[3/8] 🔎 Blocker Gate — analyzing story for conflicts (${MODEL_ANALYSIS})...\x1b[0m`);
  const prompt = `You are executing the Blocker Gate (pre-flight) of the Record-First test pipeline for ticket ${KEY}.

Source ticket: docs/tickets/${KEY}.md
${summaryRelPath
    ? `Condensed summary (PREFER THIS): ${summaryRelPath}`
    : `Condensed summary: not available — read the raw ticket + media directly.`}
Grounding sources: docs/specs/codebase/live_grounded_components.yaml, docs/specs/codebase/ui_components.yaml, docs/specs/codebase/state_machine.yaml
Business specs: docs/specs/process.yaml and docs/specs/roles.yaml

Instructions:
1. Follow .github/prompts/analyze-story.prompt.md EXACTLY.
2. Do NOT generate any test spec, testcase, or Page Object in this step — this is analysis only.
3. If you find any Blocker / Open Question that prevents safe test design, WRITE a
   "## 🔴 Open Questions & Blockers" section (Questionnaire for PO/BA) into docs/tickets/${KEY}.md
   and clearly state the story is BLOCKED.
4. If the story is safe, clearly state the gate is CLEAR and conclude whether the feature is
   "LIVE" (deployed & reachable on BASE_URL) or "NOT DEPLOYED yet".

Run the analysis now.`;

  const result = runCopilotPrompt(prompt, { model: MODEL_ANALYSIS, tmpFileSuffix: `analyze-${KEY}` });
  if (result.error) {
    fail(`Step 3 (Blocker Gate) could not start: ${result.error.message}\n   -> Ensure the "copilot" CLI is installed and on PATH.`);
  }

  if (detectBlocker(KEY, result.output)) {
    printHeader(`🔴 STORY BLOCKED — OPEN QUESTIONS / BLOCKER (${KEY})`);
    console.log(`\x1b[33m🔴 STORY BLOCKED DUE TO OPEN QUESTIONS / BLOCKER.\x1b[0m`);
    console.log(`\x1b[33mPipeline paused BEFORE recording — no Tester effort wasted.\x1b[0m`);
    console.log(`\n📄 Questionnaire for PO/BA: docs/tickets/${KEY}.md ('## 🔴 Open Questions & Blockers').`);
    console.log(`\n➡️  After PO/BA responds:`);
    console.log(`   1. Update Jira  -> npm run fetch-ticket -- ${KEY}   (or note the answer in the ticket .md)`);
    console.log(`   2. Re-run       -> npm run qa ${KEY}`);
    console.log(`\n\x1b[33m⛔ This is NOT a technical error — the gate intentionally paused to protect test quality.\x1b[0m`);
    console.log('='.repeat(58) + '\n');
    process.exit(2);
  }

  console.log(`\x1b[32m🟢 Blocker Gate CLEAR — safe to design tests.\x1b[0m`);
}

// [4] Decide the grounding mode: RECORD vs SKIP vs DRAFT ----------------------
async function stepDecideMode() {
  console.log(`\n\x1b[1m[4/8] 🌐 Checking whether the feature is live on BASE_URL...\x1b[0m`);

  const rec = readRecording(recordingFullPath);
  const hasRecording = rec.status === 'ok';

  // Explicit overrides win first.
  if (FLAGS.draft) {
    console.log(`   🧪 --draft: generating an AI draft with test.fixme guards (no recording).`);
    return 'draft';
  }
  if (FLAGS.forceRecord) {
    console.log(`   🎬 --force-record: will (re-)record the real flow.`);
    return 'record';
  }
  if (FLAGS.skipRecord) {
    if (hasRecording) {
      console.log(`   ↩️  --skip-record: reusing existing recording ${recordingRel}.`);
      return 'skip';
    }
    console.log(`   ↩️  --skip-record: no recording found — using existing grounding (POM/live YAML).`);
    return 'skip';
  }

  const reachable = await probeBaseUrl();
  if (reachable === true) console.log(`   ✅ BASE_URL responded.`);
  else if (reachable === false) console.log(`   ⚠️  BASE_URL responded with a server error.`);
  else console.log(`   ⚠️  BASE_URL not reachable / not configured (probe inconclusive).`);

  // Existing usable recording -> offer to reuse or re-record.
  if (hasRecording) {
    const choice = await askChoice(
      `        A recording already exists (${recordingRel}).\n` +
      `        [U] Use it   [R] Re-record   [D] Draft (test.fixme)\n` +
      `        Choose [U]: `,
      ['U', 'R', 'D'],
      'U'
    );
    if (choice === 'R') return 'record';
    if (choice === 'D') return 'draft';
    console.log(`   ↩️  Reusing existing recording ${recordingRel}.`);
    return 'skip';
  }

  // Server clearly unreachable and non-interactive -> safest is a draft.
  if (reachable === null && (FLAGS.ci || !(process.stdin.isTTY && process.stdout.isTTY))) {
    console.log(`   🧪 Feature not confirmed live in non-interactive mode -> AI-draft (test.fixme).`);
    return 'draft';
  }

  // Interactive: let the Tester decide (smart default = Record for new features).
  const choice = await askChoice(
    `\n        ┌─ What do you want to do? ────────────────────────────────┐\n` +
    `        │ [R] Record the real flow (recommended for new features)  │\n` +
    `        │ [S] Skip record, use existing grounding (POM/live YAML)  │\n` +
    `        │ [D] Draft without grounding (marks tests test.fixme)     │\n` +
    `        └──────────────────────────────────────────────────────────┘\n` +
    `        Choose [R]: `,
    ['R', 'S', 'D'],
    FLAGS.ci ? 'D' : 'R'
  );
  if (choice === 'S') return 'skip';
  if (choice === 'D') return 'draft';
  return 'record';
}

// [5] Record the real flow ---------------------------------------------------
function stepRecord() {
  console.log(`\n\x1b[1m[5/8] 🎬 Opening the recorder — perform the Happy Path, then CLOSE the browser.\x1b[0m`);
  console.log(`   💡 Has Validation? After the Happy Path, record ONE more short pass: leave a required`);
  console.log(`      field empty and click Submit once, so the recorder captures the real error container.`);
  if (!fs.existsSync(AUTH_STORAGE_STATE)) {
    console.warn(`   ⚠️  No .auth/user.json session found — you may land on the login screen. Run: npm run login`);
  }

  const result = runNodeScript('record-ticket.js', [KEY]);
  if (result.error) {
    fail(`Step 5 (Record) could not start: ${result.error.message}`);
  }
  const rec = readRecording(recordingFullPath);
  if (rec.status !== 'ok') {
    fail(
      `Step 5 (Record) finished but ${recordingRel} has no real interactions.\n` +
      `   -> Re-run and click/fill at least one element: npm run qa ${KEY} -- --force-record\n` +
      `   -> Or draft without grounding: npm run qa ${KEY} -- --draft`
    );
  }
  console.log(`\x1b[32m✅ Recording saved: ${recordingRel}\x1b[0m`);
}

// [6] sync-specs: Page Object + reverse-grounding ---------------------------
function stepSyncSpecs() {
  console.log(`\n\x1b[1m[6/8] 🔧 Generating Page Object + reverse-grounding live selectors...\x1b[0m`);
  try {
    const result = syncKey(KEY, { generatePom: true });
    if (result.status === 'ok') {
      console.log(`\x1b[32m✅ Reverse-grounded ${result.componentCount ?? 0} live component(s) -> ${LIVE_SPEC_REL}\x1b[0m`);
    } else {
      console.warn(`\x1b[33m⚠️  Reverse-grounding skipped (${result.status}).\x1b[0m`);
    }
    if (result.pom && (result.pom.status === 'ok' || result.pom.status === 'exists')) {
      console.log(`\x1b[32m✅ Page Object ready: ${result.pom.outRel || pomRel} (class ${pageClass})\x1b[0m`);
    }
  } catch (err) {
    console.warn(`\x1b[33m⚠️  sync-specs failed (non-fatal): ${err.message}\x1b[0m`);
  }
}

// [7] AI Test Matrix (/new-test), grounded, reuse POM ------------------------
function stepGenerateMatrix(summaryRelPath, mode) {
  console.log(`\n\x1b[1m[7/8] 🤖 Designing the GROUNDED test matrix (${MODEL_ANALYSIS})...\x1b[0m`);

  const rec = readRecording(recordingFullPath);
  const hasRecording = rec.status === 'ok';
  const hasPom = fs.existsSync(pomFullPath);

  let groundingBlock = '';
  if (hasPom) {
    groundingBlock +=
      `\n\n### 🧱 GENERATED PAGE OBJECT (MANDATORY reuse): ${pomRel} (class ${pageClass})\n` +
      `A Page Object was generated from the Tester's real recording. You MUST import and reuse its\n` +
      `locators/methods for every element it already exposes. DO NOT invent a new selector for an\n` +
      `element the Page Object already covers. If a required element is genuinely absent from the\n` +
      `Page Object, follow the 3-tier fallback in new-test.prompt.md and mark it\n` +
      `\`// ⚠️ NOT GROUNDED\` instead of guessing.\n`;
  }
  if (hasRecording) {
    groundingBlock +=
      `\n### 🎯 GROUNDING TRUTH — real Playwright recording (${recordingRel})\n` +
      `The Tester interacted with the REAL app end-to-end. Treat these selectors as HIGHER priority\n` +
      `than the static YAML extractions (which can drift). This proves the feature is LIVE — do NOT\n` +
      `add test.fixme(...) to any TC covered by this recording.\n\n` +
      '```ts\n' + rec.content + (rec.truncated ? '\n// ... (truncated for prompt size; full file on disk) ...\n' : '') + '\n```\n';
  }

  const draftGuardBlock = mode === 'draft'
    ? `\n5b. AI-DRAFT MODE: the feature is NOT confirmed live on BASE_URL and there is no grounding recording.\n` +
      `    Add \`test.fixme(true, 'Feature not yet deployed on test server')\` at the very top of EVERY\n` +
      `    individual test('TC-${KEY}-0X: ...', ...) body so the run reports a neutral fixme, never a false red.\n` +
      `    Where you cannot ground an error/validation locator, mark it \`// ⚠️ NOT GROUNDED\` and do NOT guess.\n`
    : '';

  const prompt = `You are executing the GROUNDED test-matrix generation for ticket ${KEY} in the Record-First pipeline.

Source ticket: docs/tickets/${KEY}.md
${summaryRelPath
    ? `Condensed summary (PREFER THIS over raw sources): ${summaryRelPath}\nRaw sources (fallback only):`
    : `Condensed summary: not available — read the raw sources below directly:`}
Associated media: docs/tickets/${KEY}/attachments/ (if any)
Grounding sources (priority order): docs/specs/codebase/live_grounded_components.yaml (HIGHEST when present), then docs/specs/codebase/ui_components.yaml and docs/specs/codebase/state_machine.yaml${groundingBlock}
Business specs: docs/specs/process.yaml and docs/specs/roles.yaml

Instructions:
1. Follow .github/prompts/new-test.prompt.md EXACTLY${hasPom ? ', reusing the generated Page Object above (do NOT invent selectors it already covers)' : ''}.
2. Design a modular Test Matrix — one independent sub test case per real business aspect present in
   THIS ticket (TC-${KEY}-01 Happy Path, TC-${KEY}-02 Validation, TC-${KEY}-03 Boundary, and any
   role/state/error/edge aspects the ticket genuinely requires). Do NOT pad or force-fit a template.
3. Generate:
   - tests/testcases/TC-${KEY}.md (100% English Given/When/Then; keep German UI labels verbatim)
   - tests/pages/${pageClass}.ts (extend it ONLY if new grounded components are needed)
   - ${specRel} (one independent test('TC-${KEY}-0X: ...') per aspect, all inside one test.describe())
4. For Negative/Validation TCs, resolve the error-message locator using the 3-tier fallback in
   new-test.prompt.md: (a) a recorded validation pass, else (b) ui_components.yaml required/error
   containers, else (c) mark \`// ⚠️ NOT GROUNDED\`. NEVER invent an error selector that turns the test red falsely.
5. Language: all files/titles/steps/comments in professional English; keep original German UI labels verbatim.${draftGuardBlock}
6. Output spec path is exactly: ${specRel}

Generate or update these files now.`;

  const result = runCopilotPrompt(prompt, { model: MODEL_ANALYSIS, tmpFileSuffix: `generate-${KEY}` });
  if (result.error) {
    fail(`Step 7 (Generate matrix) could not start: ${result.error.message}\n   -> Ensure the "copilot" CLI is installed and on PATH.`);
  }
  if (result.status !== 0) {
    fail(`Step 7 (Generate matrix) failed with exit code ${result.status}. Step 8 was NOT run.`);
  }
  if (!fs.existsSync(specFullPath)) {
    if (detectBlocker(KEY, result.output)) {
      printHeader(`🔴 STORY BLOCKED DURING GENERATION (${KEY})`);
      console.log(`\x1b[33m🔴 The story was blocked while designing tests. See docs/tickets/${KEY}.md.\x1b[0m`);
      process.exit(2);
    }
    fail(`Step 7 completed but ${specRel} was not created. Step 8 was NOT run.`);
  }
  console.log(`\x1b[32m✅ Test matrix generated: ${specRel} (+ tests/testcases/TC-${KEY}.md)\x1b[0m`);
}

// [8] Run Playwright, self-heal on failure -----------------------------------
function runPlaywright(label) {
  console.log(`\n\x1b[1m${label}\x1b[0m\n`);
  const normalized = specRel.split(path.sep).join('/');
  const npxBin = resolveWindowsBinary('npx');
  const args = ['playwright', 'test', normalized, '--project=chromium'];
  if (FLAGS.headed) args.push('--headed');
  const result = safeSpawnSync(npxBin, args, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: { ...process.env, INTERACTIVE_SSO: FLAGS.headed ? '1' : '0' },
  });
  if (result.error) fail(`Step 8 (Playwright run) could not start: ${result.error.message}`);
  return result.status === 0;
}

function stepRunAndHeal() {
  let passed = runPlaywright('[8/8] 🧪 Running Playwright verification...');
  let selfHealed = false;
  if (!passed) {
    console.log('\n\x1b[33m🩺 [AI-HEAL] Test failed — triggering ai-healer.js to self-heal...\x1b[0m');
    const healRes = runNodeScript('ai-healer.js', [KEY], { AUTO_TEST_SELF_HEAL_MODEL: MODEL_SELF_HEAL });
    if (!healRes.error && healRes.status === 0) {
      selfHealed = true;
      passed = runPlaywright('🔁 Re-running Playwright after self-healing...');
    } else {
      console.warn('\x1b[33m⚠️  Self-healing could not complete. Reporting the original result.\x1b[0m');
    }
  }
  return { passed, selfHealed };
}

// ───────────────────────────── Orchestrate ─────────────────────────────

async function main() {
  printHeader(`🚀 QA RECORD-FIRST PIPELINE — ${KEY}`);

  stepFetch();
  const summaryRelPath = stepSummarize();
  stepBlockerGate(summaryRelPath);

  const mode = await stepDecideMode();

  if (mode === 'record') {
    stepRecord();
    stepSyncSpecs();
  } else if (mode === 'skip') {
    // Reuse existing recording (if any) to keep the Page Object/live YAML fresh.
    if (readRecording(recordingFullPath).status === 'ok') stepSyncSpecs();
    else console.log(`\n\x1b[1m[6/8] ⏭️  No recording to sync — relying on existing grounding (POM/live YAML).\x1b[0m`);
  } else {
    console.log(`\n\x1b[1m[5/8] ⏭️  Draft mode — skipping recording.\x1b[0m`);
    console.log(`\x1b[1m[6/8] ⏭️  Draft mode — skipping Page Object sync.\x1b[0m`);
  }

  stepGenerateMatrix(summaryRelPath, mode);
  const { passed, selfHealed } = stepRunAndHeal();

  printHeader(`🎉 QA PIPELINE COMPLETED — ${KEY}`);
  console.log(`  * Ticket:    docs/tickets/${KEY}.md`);
  if (fs.existsSync(recordingFullPath)) console.log(`  * Recording: ${recordingRel}`);
  if (fs.existsSync(pomFullPath)) console.log(`  * Page Obj:  ${pomRel}`);
  console.log(`  * Testcase:  tests/testcases/TC-${KEY}.md`);
  console.log(`  * Spec:      ${specRel}`);
  if (selfHealed) console.log(`  * Self-heal: applied (ai-healer.js) after the first run failed.`);
  console.log(passed
    ? `\n\x1b[32m✅ RESULT: Playwright test PASSED — First-Time Green!\x1b[0m`
    : `\n\x1b[31m❌ RESULT: Playwright test FAILED — see: npm run report\x1b[0m`);
  console.log('='.repeat(58) + '\n');

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  fail(`Unexpected error in QA pipeline: ${err && err.stack ? err.stack : err}`);
});
