/**
 * E.ON Ticket Pipeline -- 1-command wizard for Jira ticket testing.
 *
 * Orchestrates the full lifecycle for a Jira ticket without the tester
 * needing to remember or type sequential commands:
 *
 *   npm run ticket SEC-11359
 *
 * Steps (all automatic, tester only interacts with the browser):
 *   1. Fetch story from Jira -> docs/tickets/<KEY>.md        (skip if exists)
 *   2. Launch Playwright Codegen for tester to record the flow  (skip if recording exists)
 *   3. [AUTO] sync-specs: generate Page Object + Test Spec
 *   4. [AUTO] Run Playwright test and report Pass/Fail
 *
 * Flags:
 *   --skip-fetch    Skip Jira fetch (use existing docs/tickets/<KEY>.md)
 *   --skip-record   Skip codegen (use existing recording)
 *   --force-record  Force re-record even if recording already exists
 *   --force-fetch   Force re-fetch from Jira even if .md already exists
 *   --headless      Run verification test in headless mode (default: headed)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT_DIR, 'tests', 'recordings');
const AUTH_STORAGE_STATE = path.join(ROOT_DIR, '.auth', 'user.json');

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

function printBanner(title) {
  const line = '='.repeat(58);
  console.log(`\n${line}`);
  console.log(` ${title}`);
  console.log(`${line}`);
}

function runScript(scriptName, args = [], extraEnv = {}) {
  const nodeBin = process.execPath;
  const scriptPath = path.join(__dirname, scriptName);
  const result = safeSpawnSync(nodeBin, [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: { ...process.env, ...extraEnv },
  });
  return result;
}

function parseKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  value = value.split(/[?#]/)[0].replace(/\/+$/, '');
  const segment = value.split('/').pop();
  const match = segment.match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
}

const argv = process.argv.slice(2);
const positional = argv.find((a) => !a.startsWith('--'));
const key = parseKey(positional);

if (!key) {
  console.log('\n[USAGE]  npm run ticket <TICKET_KEY>');
  console.log('   Example: npm run ticket SEC-11359');
  console.log('\n[FLAGS]');
  console.log('   --skip-fetch    Skip Jira fetch (use existing ticket .md)');
  console.log('   --skip-record   Skip codegen (use existing recording)');
  console.log('   --force-record  Force re-record even if recording exists');
  console.log('   --force-fetch   Force re-fetch from Jira even if .md exists');
  console.log('   --headless      Run verification in headless mode\n');
  process.exit(1);
}

const SKIP_FETCH   = argv.includes('--skip-fetch');
const SKIP_RECORD  = argv.includes('--skip-record');
const FORCE_RECORD = argv.includes('--force-record');
const FORCE_FETCH  = argv.includes('--force-fetch');
const HEADLESS     = argv.includes('--headless');

const npxBin        = resolveWindowsBinary('npx');
const ticketMdPath  = path.join(ROOT_DIR, 'docs', 'tickets', `${key}.md`);
const recordingPath = path.join(RECORDINGS_DIR, `${key}.recording.ts`);
const relRecording  = `tests/recordings/${key}.recording.ts`;

// ---------------------------------------------------------------------------
// STEP 1 -- Fetch Jira story
// ---------------------------------------------------------------------------

printBanner(`[1/4] TICKET PIPELINE: ${key}`);

const shouldFetch = !SKIP_FETCH && (FORCE_FETCH || !fs.existsSync(ticketMdPath));
if (shouldFetch) {
  console.log(`\n[Step 1] Fetching Jira story for: ${key}`);
  const fetchResult = runScript('fetch-jira.js', [key]);
  if (fetchResult.error || fetchResult.status !== 0) {
    console.error(`\n[ERROR] fetch-jira failed (exit ${fetchResult.status ?? 'N/A'}).`);
    console.error(`   -> Check your Jira credentials in .env (JIRA_BASE_URL, JIRA_API_TOKEN)`);
    process.exit(fetchResult.status ?? 1);
  }
  console.log(`[OK] Jira story saved: docs/tickets/${key}.md`);
} else if (fs.existsSync(ticketMdPath)) {
  console.log(`\n[Step 1] Skipped -- ticket already exists: docs/tickets/${key}.md`);
} else {
  console.log(`\n[Step 1] Skipped (--skip-fetch). WARNING: docs/tickets/${key}.md does not exist.`);
}

// ---------------------------------------------------------------------------
// STEP 2 -- Record (Playwright Codegen)
// ---------------------------------------------------------------------------

const shouldRecord = !SKIP_RECORD && (FORCE_RECORD || !fs.existsSync(recordingPath));
if (shouldRecord) {
  console.log(`\n[Step 2] Launching Playwright Codegen for: ${key}`);
  console.log(`   -> Browser will open. Perform the test flow, then CLOSE the browser.`);
  console.log(`   -> The pipeline continues automatically after you close it.\n`);

  const codegenArgs = [
    'playwright', 'codegen',
    '--target=playwright-test',
    `--output=${relRecording}`,
  ];
  if (fs.existsSync(AUTH_STORAGE_STATE)) {
    codegenArgs.push('--load-storage=.auth/user.json');
  }
  const startUrl = process.env.BASE_URL || 'http://localhost:3000';
  codegenArgs.push(startUrl);

  const codegenResult = safeSpawnSync(npxBin, codegenArgs, { stdio: 'inherit', cwd: ROOT_DIR });

  if (codegenResult.error) {
    console.error(`\n[ERROR] Could not start Playwright codegen: ${codegenResult.error.message}`);
    process.exit(1);
  }
  if (!fs.existsSync(recordingPath)) {
    console.warn(`\n[WARN] Recorder closed but ${relRecording} was not created (no actions recorded?).`);
    console.warn(`   -> Re-run: npm run ticket ${key} -- --force-record\n`);
    process.exit(1);
  }
  console.log(`[OK] Recording saved: ${relRecording}`);
} else if (fs.existsSync(recordingPath)) {
  console.log(`\n[Step 2] Skipped -- recording already exists: ${relRecording}`);
} else {
  console.log(`\n[Step 2] Skipped (--skip-record). WARNING: ${relRecording} does not exist.`);
}

// ---------------------------------------------------------------------------
// STEP 3 -- Sync Specs (generate Page Object + Test Spec)
// ---------------------------------------------------------------------------

console.log(`\n[Step 3] Generating Page Object + Test Spec for: ${key}`);
const syncResult = runScript('sync-specs.js', [key]);
if (syncResult.error || syncResult.status !== 0) {
  console.error(`\n[ERROR] sync-specs failed (exit ${syncResult.status ?? 'N/A'}).`);
  console.error(`   -> Run manually: npm run sync-specs ${key}`);
  process.exit(syncResult.status ?? 1);
}
console.log(`[OK] Spec files generated.`);

// ---------------------------------------------------------------------------
// STEP 3.5 -- Pipeline Gatekeeper: TypeScript dry-run validation
// Detect locator/type errors BEFORE running the full test to save time.
// ---------------------------------------------------------------------------

console.log(`\n[Step 3.5] TypeScript dry-run validation on generated specs...`);
const specForTs = `tests/e2e/TC-${key}.spec.ts`;
const pomForTs  = `tests/pages/functions/${key.charAt(0).toUpperCase() + key.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Page.ts`;
// Try TSC if installed, otherwise skip gracefully
const tscResult = safeSpawnSync(
  'npx',
  ['tsc', '--noEmit', '--strict', '--target', 'ES2020', '--module', 'commonjs', '--esModuleInterop', '--skipLibCheck', specForTs],
  { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT_DIR }
);
const tscOut = (tscResult.stdout || '').toString().trim();
const tscErr = (tscResult.stderr || '').toString().trim();
if (tscResult.error) {
  console.warn(`  [SKIP] TypeScript check skipped: ${tscResult.error.message}`);
} else if (tscResult.status !== 0) {
  const tscOutput = [tscOut, tscErr].filter(Boolean).join('\n');
  console.error(`\n[ERROR] TypeScript validation FAILED for: ${specForTs}`);
  console.error(tscOutput || '(no output)');
  console.error(`  -> Fix above errors in sync-specs.js then re-run: npm run sync-specs ${key}`);
  process.exit(2);
} else {
  console.log(`[OK] TypeScript validation passed.`);
}

// ---------------------------------------------------------------------------
// STEP 4 -- Run Playwright Test
// ---------------------------------------------------------------------------

const specRel  = `tests/e2e/TC-${key}.spec.ts`;
const specFull = path.join(ROOT_DIR, specRel);
if (!fs.existsSync(specFull)) {
  console.error(`\n[ERROR] Test spec not found after sync-specs: ${specRel}`);
  process.exit(1);
}

console.log(`\n[Step 4] Running Playwright test: ${specRel}`);
const playwrightArgs = ['playwright', 'test', specRel, '--project=chromium'];
if (!HEADLESS) playwrightArgs.push('--headed');

const testResult = safeSpawnSync(npxBin, playwrightArgs, {
  stdio: 'inherit',
  cwd: ROOT_DIR,
  env: { ...process.env, INTERACTIVE_SSO: HEADLESS ? '0' : '1' },
});

let passed = !testResult.error && testResult.status === 0;
if (!passed) {
  console.log('\n\x1b[33m[AI-HEAL] Pipeline Step 4 failed. Triggering AI Healer CLI to self-heal POM...\x1b[0m');
  const healRes = runScript('ai-healer.js', [key]);
  if (!healRes.error && healRes.status === 0) {
    passed = true;
    console.log('\x1b[32m[AI-HEAL] Self-healing succeeded! Test is now passing.\x1b[0m');
  }
}

// ---------------------------------------------------------------------------
// FINAL SUMMARY
// ---------------------------------------------------------------------------

printBanner(`[DONE] PIPELINE COMPLETED: ${key}`);
console.log(`  * Ticket:    docs/tickets/${key}.md`);
if (fs.existsSync(recordingPath)) console.log(`  * Recording: ${relRecording}`);
console.log(`  * Spec:      ${specRel}`);
console.log(passed
  ? `\n  [RESULT] PASSED -- All steps verified successfully.`
  : `\n  [RESULT] FAILED -- See output above. Try: npm run report`
);
console.log('='.repeat(58) + '\n');

process.exit(passed ? 0 : 1);