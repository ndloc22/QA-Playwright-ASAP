/**
 * E.ON Post-Deploy Smoke Test Runner
 *
 * Runs a comprehensive health check after a QA deploy:
 *   Phase 1: Menu & link crawler (detects dead links / error dialogs)
 *   Phase 2: Core business function verification (driven by config/post-deploy-smoke.json)
 *
 * Usage:
 *   npm run test:post-deploy
 *   npm run test:smoke
 *
 *   # Skip menu crawl, only run functions:
 *   npm run test:post-deploy -- --no-crawl
 *
 *   # Stop on first failure:
 *   npm run test:post-deploy -- --stop-on-failure
 *
 * Configuration: edit config/post-deploy-smoke.json to set which functions to run.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'post-deploy-smoke.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  const line = '='.repeat(60);
  console.log(`\n${line}`);
  console.log(` ${title}`);
  console.log(`${line}`);
}

function printSection(title) {
  console.log(`\n--- ${title} ---`);
}

// ---------------------------------------------------------------------------
// Load configuration
// ---------------------------------------------------------------------------

if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`[ERROR] Config file not found: config/post-deploy-smoke.json`);
  console.error(`   -> Create it from the template or re-run: git checkout config/post-deploy-smoke.json`);
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (e) {
  console.error(`[ERROR] Failed to parse config/post-deploy-smoke.json: ${e.message}`);
  process.exit(1);
}

// CLI flags override config values
const argv = process.argv.slice(2);
const crawlMenus      = !argv.includes('--no-crawl') && (config.crawlMenus !== false);
const stopOnFailure   = argv.includes('--stop-on-failure') || config.stopOnFailure === true;
const functionSequence = Array.isArray(config.sequence) ? config.sequence : [];

const npxBin = resolveWindowsBinary('npx');

// ---------------------------------------------------------------------------
// Track results
// ---------------------------------------------------------------------------

const results = [];  // { name, phase, passed, duration }
let globalPassed = true;

function recordResult(name, phase, passed, durationMs) {
  results.push({ name, phase, passed, duration: `${(durationMs / 1000).toFixed(1)}s` });
  if (!passed) globalPassed = false;
}

// ---------------------------------------------------------------------------
// PHASE 1: Menu & Link Crawler
// ---------------------------------------------------------------------------

printBanner('POST-DEPLOY SMOKE TEST');
console.log(`  Config:    config/post-deploy-smoke.json`);
console.log(`  Functions: ${functionSequence.length} (${functionSequence.join(', ') || 'none'})`);
console.log(`  Crawl menus: ${crawlMenus}`);
console.log(`  Stop on failure: ${stopOnFailure}`);

if (crawlMenus) {
  printSection('Phase 1: Menu & Link Health Check');

  // Create a temporary Playwright spec that runs the MenuCrawler
  const smokeDir = path.join(ROOT_DIR, 'tests', 'e2e', 'smoke');
  fs.mkdirSync(smokeDir, { recursive: true });

  const crawlerSpecPath = path.join(smokeDir, '_menu-health-check.spec.ts');
  const crawlerSpec = `
import { test, expect } from '@playwright/test';
import { MenuCrawler } from '../../support/menu-crawler';

test('Post-Deploy: Menu & Link Health Check', async ({ page }) => {
  const crawler = new MenuCrawler(page);
  await crawler.ensureOnPortal();

  const report = await crawler.crawlTopMenu({ timeout: 20000 });

  console.log('\\n[MenuCrawler] Results:');
  for (const r of report.results) {
    const icon = r.status === 'OK' ? '[OK]  ' : '[FAIL]';
    console.log(\`  \${icon} \${r.label.padEnd(40)} \${r.status} -- \${r.detail}\`);
  }
  console.log(\`\\n  Summary: \${report.passed}/\${report.total} menus OK, \${report.deadLinks} issues\`);

  expect(report.deadLinks, \`\${report.deadLinks} menu(s) failed health check -- see output above\`).toBe(0);
});
`;

  fs.writeFileSync(crawlerSpecPath, crawlerSpec, 'utf-8');

  const crawlStart = Date.now();
  const crawlResult = safeSpawnSync(npxBin, [
    'playwright', 'test',
    '_menu-health-check.spec.ts',
    '--project=chromium',
    '--headed',
  ], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: { ...process.env, INTERACTIVE_SSO: '1' },
  });
  const crawlPassed = !crawlResult.error && crawlResult.status === 0;
  recordResult('Menu & Link Crawl', 'Phase 1', crawlPassed, Date.now() - crawlStart);

  if (!crawlPassed && stopOnFailure) {
    console.error(`\n[STOP] Menu crawl failed and --stop-on-failure is set. Aborting.`);
    printSummary();
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// PHASE 2: Core Function Verification (reads from config/post-deploy-smoke.json)
// ---------------------------------------------------------------------------

if (functionSequence.length > 0) {
  printSection(`Phase 2: Core Function Verification (${functionSequence.length} functions)`);

  for (let i = 0; i < functionSequence.length; i++) {
    const name = functionSequence[i];
    const specRel = `tests/e2e/functions/TC-${name}.spec.ts`;
    const specFull = path.join(ROOT_DIR, specRel);

    console.log(`\n[${i + 1}/${functionSequence.length}] Running function: ${name}`);

    if (!fs.existsSync(specFull)) {
      console.warn(`  [SKIP] Spec not found: ${specRel}`);
      console.warn(`     -> Record it first: npm run record:function ${name}`);
      recordResult(name, 'Phase 2', false, 0);
      if (stopOnFailure) {
        console.error(`\n[STOP] Stopping on first failure (--stop-on-failure).`);
        break;
      }
      continue;
    }

    const fnStart = Date.now();
    const fnResult = safeSpawnSync(npxBin, [
      'playwright', 'test',
      specRel,
      '--project=chromium',
      '--headed',
    ], {
      stdio: 'inherit',
      cwd: ROOT_DIR,
      env: { ...process.env, INTERACTIVE_SSO: '1' },
    });

    const fnPassed = !fnResult.error && fnResult.status === 0;
    recordResult(name, 'Phase 2', fnPassed, Date.now() - fnStart);

    if (!fnPassed && stopOnFailure) {
      console.error(`\n[STOP] Function ${name} FAILED and --stop-on-failure is set. Aborting remaining functions.`);
      break;
    }
  }
} else {
  console.log(`\n[Phase 2] No functions configured in config/post-deploy-smoke.json (sequence is empty).`);
  console.log(`   -> Add function names to run: edit "sequence": ["CREATE_RISK_REQUEST", ...]`);
}

// ---------------------------------------------------------------------------
// FINAL SUMMARY DASHBOARD
// ---------------------------------------------------------------------------

function printSummary() {
  const totalRan     = results.length;
  const totalPassed  = results.filter((r) => r.passed).length;
  const totalFailed  = totalRan - totalPassed;
  const overallIcon  = globalPassed ? '[PASSED]' : '[FAILED]';

  printBanner(`SMOKE SUITE SUMMARY -- ${overallIcon}`);

  // Table header
  const COL = { name: 38, phase: 10, status: 8, duration: 8 };
  const header = `${'FUNCTION/CHECK'.padEnd(COL.name)} ${'PHASE'.padEnd(COL.phase)} ${'STATUS'.padEnd(COL.status)} ${'TIME'.padEnd(COL.duration)}`;
  const divider = '-'.repeat(header.length);
  console.log(header);
  console.log(divider);

  for (const r of results) {
    const status = r.passed ? 'PASSED' : 'FAILED';
    const row = `${r.name.padEnd(COL.name)} ${r.phase.padEnd(COL.phase)} ${status.padEnd(COL.status)} ${r.duration}`;
    console.log(row);
  }

  console.log(divider);
  console.log(`TOTAL: ${totalPassed}/${totalRan} passed, ${totalFailed} failed`);
  console.log(`\nOverall result: ${globalPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  if (!globalPassed) {
    console.log(`-> Open HTML report: npm run report`);
    console.log(`-> Re-run a single function: npm run test:function <NAME>`);
  }
  console.log('='.repeat(60) + '\n');
}

printSummary();
process.exit(globalPassed ? 0 : 1);