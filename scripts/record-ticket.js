/**
 * E.ON Grounding Recorder: Playwright codegen scoped to a Jira ticket key
 * Usage:
 *   npm run record:ticket KFWT-1161
 *   npm run record:ticket -- KFWT-1161 --url /some/deep/link
 *
 * What this does (answers "how to make regenerate automatically reference codegen"):
 *   1. Loads BASE_URL from .env (same source of truth as playwright.config.ts).
 *   2. Loads the already-authenticated browser session from .auth/user.json
 *      (the storageState captured by the Tester's normal login flow), so the
 *      Tester lands directly on the real app instead of the login screen.
 *   3. Launches a Playwright-powered recorder (programmatic API, not CLI spawn),
 *      which lets the Tester click through the REAL flow on the REAL app while
 *      Playwright records real, DOM-grounded selectors (no guessing).
 *      Using the API (vs `npx playwright codegen`) allows injecting initScripts
 *      BEFORE page load -- enabling the iframe scroll fix below.
 *   4. Saves the generated script to tests/recordings/<KEY>.recording.ts.
 *
 * That file is then AUTO-DETECTED by scripts/auto-test.js: any subsequent
 * `npm run auto-test <KEY>` or `npm run regenerate <KEY>` run automatically
 * loads it as the highest-priority Grounding Truth source for Page Object +
 * Test Spec generation, and instructs Copilot to drop any `test.fixme(...)`
 * guard for flows the recording proves are live -- no manual copy/paste of
 * the codegen output into chat required.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

// ---------------------------------------------------------------------------
// IFRAME SCROLL FIX -- injected into every page during recording ONLY.
//
// Problem: Axon Ivy Portal wraps task forms inside iframe[title="Task frame"].
// The portal fixes the iframe height to the viewport and sets overflow:hidden
// on parent containers, so when the form grows tall (e.g. extra items added
// by the Tester), buttons at the bottom (Next / Cancel / Save) are clipped
// off-screen. Scrolling with the mouse wheel has no effect because the scroll
// is trapped by the parent overflow:hidden layout.
//
// Fix: MutationObserver watches for the iframe to appear in the DOM and
// immediately sets scrolling="yes" + overflow:auto on both the iframe itself
// and any parent container that is hiding overflow. Polling at 800 ms handles
// PrimeFaces AJAX panels that render asynchronously after the initial load.
//
// Impact on recordings: ZERO. Playwright codegen records user gestures
// (clicks, fills, presses) -- it does NOT record scroll events. The resulting
// .recording.ts file is byte-for-byte identical to what CLI codegen produces.
//
// Impact on test runs: ZERO. This initScript is only added to the recorder
// context launched by record-ticket.js; it is NOT present in playwright.config.ts
// or any test file.
// ---------------------------------------------------------------------------
const IFRAME_SCROLL_FIX_SCRIPT = `
(function () {
  'use strict';
  function fixIframeScroll() {
    var selectors = [
      'iframe[title="Task frame"]',
      'iframe[title*="Task"]',
      'iframe[class*="task-frame"]',
      'iframe[id*="taskFrame"]'
    ];
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (iframe) {
        if (iframe.getAttribute('scrolling') !== 'yes') {
          iframe.setAttribute('scrolling', 'yes');
        }
        iframe.style.overflow = 'auto';
      });
    });
    // Fix parent containers that suppress scroll via overflow:hidden.
    // Only touch containers that actually have content taller than themselves.
    document.querySelectorAll(
      '.ui-widget-content, .ui-dialog-content, .task-frame-wrapper, ' +
      '.portal-task-container, .ivy-frame-wrapper'
    ).forEach(function (el) {
      var cs = window.getComputedStyle(el);
      if ((cs.overflow === 'hidden' || cs.overflowY === 'hidden') &&
          el.scrollHeight > el.clientHeight + 10) {
        el.style.overflowY = 'auto';
      }
    });
  }

  if (document.readyState !== 'loading') {
    fixIframeScroll();
  } else {
    document.addEventListener('DOMContentLoaded', fixIframeScroll);
  }

  // Watch for PrimeFaces AJAX-driven DOM changes (lazy panels, accordions, etc.)
  new MutationObserver(fixIframeScroll).observe(
    document.documentElement,
    { childList: true, subtree: true }
  );

  // Polling fallback: handles cases where the portal JS resolves the iframe
  // src / height AFTER MutationObserver fires.
  setInterval(fixIframeScroll, 800);
})();
`;

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT_DIR, 'tests', 'recordings');
const AUTH_STORAGE_STATE = path.join(ROOT_DIR, '.auth', 'user.json');

function detectScreenResolution() {
  if (IS_WINDOWS) {
    try {
      const psCmdW = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width';
      const psCmdH = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height';
      const resW = spawnSync('powershell', ['-NoProfile', '-Command', psCmdW], { encoding: 'utf8', timeout: 3000 });
      const resH = spawnSync('powershell', ['-NoProfile', '-Command', psCmdH], { encoding: 'utf8', timeout: 3000 });
      const resBounds = { error: resW.error || resH.error, stdout: resW.stdout + ',' + resH.stdout };
      if (!resBounds.error && resBounds.stdout) {
        const parts = resBounds.stdout.trim().split(',').map(s => s.trim());
        const wRaw = parseInt(parts[0], 10);
        const hRaw = parseInt(parts[1], 10);
        if (!isNaN(wRaw) && !isNaN(hRaw) && wRaw > 0 && hRaw > 0) {
          let dpi = 96;
          try {
            const resDpi = spawnSync(
              'powershell',
              [
                '-NoProfile',
                '-Command',
                "Get-ItemPropertyValue -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name 'AppliedDPI' -ErrorAction Stop"
              ],
              { encoding: 'utf8', timeout: 3000 }
            );
            if (!resDpi.error && resDpi.stdout) {
              const parsed = parseInt(resDpi.stdout.trim(), 10);
              if (!isNaN(parsed) && parsed >= 96) dpi = parsed;
            }
          } catch (_) {
            // ignore
          }
          const wLogical = Math.round(wRaw * 96 / dpi);
          const hLogical = Math.round(hRaw * 96 / dpi);
          return `${wLogical},${hLogical}`;
        }
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function parseTicketKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  if (!value) return null;
  value = value.split(/[?#]/)[0].replace(/\/+$/, '');
  const segment = value.split('/').pop();
  const match = segment.match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Resolve the correct Windows executable shim for a CLI tool (npx.cmd vs
 * npx.exe vs bare) so we never hardcode an extension that might not exist
 * for a given install method. See scripts/auto-test.js for the same helper
 * (duplicated here to keep this script runnable standalone).
 */
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

const argv = process.argv.slice(2);
// Group 2 (Function/Module) mode: `npm run record:function <NAME>` (which passes
// --function) OR being invoked via the record:function lifecycle event. In this
// mode the recording is grouped under tests/recordings/functions/ so it never
// collides with Group 1 (Jira Ticket) recordings, and every downstream tool
// (sync-specs.js, auto-test.js, Playwright) auto-detects that grouping.
const FUNCTION_MODE =
  argv.includes('--function') || process.env.npm_lifecycle_event === 'record:function';
const MODE_LABEL = FUNCTION_MODE ? 'FUNCTION' : 'TICKET';
const RECORD_CMD = FUNCTION_MODE ? 'record:function' : 'record:ticket';
const TARGET_RECORDINGS_DIR = FUNCTION_MODE ? path.join(RECORDINGS_DIR, 'functions') : RECORDINGS_DIR;
const urlFlagIndex = argv.indexOf('--url');
const viewportFlagIndex = argv.indexOf('--viewport');
// First positional argument that is not a flag and not the value of `--url`
// or `--viewport`.
const target = argv.find(
  (arg, idx) =>
    !arg.startsWith('--') &&
    (urlFlagIndex === -1 || idx !== urlFlagIndex + 1) &&
    (viewportFlagIndex === -1 || idx !== viewportFlagIndex + 1),
);
const key = parseTicketKey(target);

if (!key) {
  console.log('\n\x1b[33mUsage:\x1b[0m');
  console.log('   \x1b[36mGroup 1 (Jira Ticket):\x1b[0m  npm run record:ticket <TICKET_KEY> [-- --url <path>]');
  console.log('      Example: npm run record:ticket KFWT-1161');
  console.log('   \x1b[36mGroup 2 (Function):\x1b[0m     npm run record:function <FUNCTION_NAME> [-- --url <path>]');
  console.log('      Example: npm run record:function SEARCH_TELECONTROL');
  console.log('\n\x1b[33mViewport (automatic):\x1b[0m auto-scaled to 100% of your primary display (e.g. 2K 2560x1440, Full HD 1920x1080).\n' +
    '   \x1b[36mPresets:\x1b[0m  --2k (2560x1440) | --fullhd (1920x1080) | --desktop (1600x900) | --laptop (1366x768)\n' +
    '   \x1b[36mCustom:\x1b[0m   --viewport <w,h>   (e.g. --viewport 2560,1440)\n' +
    '   \x1b[36m.env:\x1b[0m     CODEGEN_VIEWPORT=auto   (leave blank or auto = full resolution of your display)\n' +
    '   Example: npm run record:ticket <KEY> -- --2k\n');
  process.exit(1);
}

// Optional `--url <path>` lets the Tester start codegen deeper inside the app
// (e.g. directly on the screen under test) instead of BASE_URL's root page.
let startUrl = process.env.BASE_URL || 'http://127.0.0.1:3001';

if (urlFlagIndex !== -1 && argv[urlFlagIndex + 1]) {
  const extraPath = argv[urlFlagIndex + 1];
  startUrl = startUrl.replace(/\/+$/, '') + (extraPath.startsWith('/') ? extraPath : `/${extraPath}`);
}

// Convenience preset flags let the Tester choose another fixed size when needed:
const VIEWPORT_PRESETS = {
  '--2k': '2560,1440',
  '--qhd': '2560,1440',
  '--fullhd': '1920,1080',
  '--desktop': '1600,900',
  '--laptop': '1366,768',
};

// Viewport resolution for codegen. Automatically detects the machine's primary
// screen resolution (e.g. 2560x1440 on 2K displays or 1920x1080 on Full HD) so the
// recorder opens 100% full-screen / borderless without awkward letterboxing or blank
// margins. Fallback to 1920x1080 if screen detection is unavailable (e.g. CI / headless).
//
// Override precedence (lowest -> highest):
//   1. Auto-detected primary screen resolution (fallback 1920x1080)
//   2. CODEGEN_VIEWPORT env var (if not 'auto' and not empty)
//   3. Preset flag: --2k | --fullhd | --desktop | --laptop
//   4. Free-form flag: --viewport <w,h>
let viewportSize = process.env.CODEGEN_VIEWPORT && process.env.CODEGEN_VIEWPORT !== 'auto'
  ? process.env.CODEGEN_VIEWPORT
  : (detectScreenResolution() || '1920,1080');
for (const [flag, preset] of Object.entries(VIEWPORT_PRESETS)) {
  if (argv.includes(flag)) {
    viewportSize = preset;
  }
}
if (viewportFlagIndex !== -1 && argv[viewportFlagIndex + 1]) {
  viewportSize = argv[viewportFlagIndex + 1];
}
if (viewportSize) {
  viewportSize = viewportSize.replace(/\s+/g, '');
}

if (!fs.existsSync(TARGET_RECORDINGS_DIR)) {
  fs.mkdirSync(TARGET_RECORDINGS_DIR, { recursive: true });
}

const relRecordingPath = FUNCTION_MODE
  ? `tests/recordings/functions/${key}.recording.ts`
  : `tests/recordings/${key}.recording.ts`;
const fullRecordingPath = path.join(TARGET_RECORDINGS_DIR, `${key}.recording.ts`);

const hasAuthStorage = fs.existsSync(AUTH_STORAGE_STATE);
if (!hasAuthStorage) {
  console.warn('\x1b[33m[WARN] .auth/user.json not found -- codegen will start WITHOUT a preloaded login session.\x1b[0m');
  console.warn(`   -> If the app requires login, sign in manually inside the recorder window, or capture a\n      storageState first (e.g. via Playwright's authentication docs) and save it to .auth/user.json.`);
}

console.log(`\n======================================================`);
console.log(`[REC] RECORDING ${MODE_LABEL} GROUNDING TRUTH FOR \x1b[36m${key}\x1b[0m`);
console.log(`======================================================\n`);
console.log(`  * BASE_URL:        ${startUrl}`);
console.log(`  * Auth session:    ${hasAuthStorage ? '.auth/user.json (preloaded)' : '(none -- will start logged out)'}`);
console.log(`  * Output file:     ${relRecordingPath}`);
const isAuto = (!process.env.CODEGEN_VIEWPORT || process.env.CODEGEN_VIEWPORT === 'auto') &&
  !Object.keys(VIEWPORT_PRESETS).some((f) => argv.includes(f)) &&
  viewportFlagIndex === -1;
console.log(`  * Viewport:        ${viewportSize.replace(',', ' x ')}${isAuto ? ' (auto-detected from primary display)' : ''}`);
console.log(`  * Scroll fix:      \x1b[32mON\x1b[0m (iframe scrollbar auto-enabled for long forms)`);
console.log(`\n--> A browser window will open. Perform the real flow described in the ticket, then close the`);
console.log(`   browser window (or Playwright Inspector) to finish -- the recorded script is saved automatically.\n`);

// ---------------------------------------------------------------------------
// PROGRAMMATIC RECORDER LAUNCHER
//
// Replaced the former `npx playwright codegen` CLI spawn with a programmatic
// Playwright API approach so we can inject IFRAME_SCROLL_FIX_SCRIPT via
// context.addInitScript() BEFORE the first page load.
//
// Architecture: We write an async launcher script to a temp file and spawn it
// as a child Node.js process. This keeps record-ticket.js fully synchronous
// while the async Playwright API runs in the child. The child process exits
// only when the Tester closes the Playwright Inspector window.
//
// The recorder engine used (context._enableRecorder) is the exact same
// internal engine that `npx playwright codegen` calls -- output is identical.
// ---------------------------------------------------------------------------
const [vpW, vpH] = viewportSize.split(',').map((n) => parseInt(n.trim(), 10));

const pwCorePath = JSON.stringify(path.join(ROOT_DIR, 'node_modules', 'playwright-core'));
const authStorageLine = hasAuthStorage
  ? `    storageState: ${JSON.stringify(AUTH_STORAGE_STATE)},`
  : `    // no storageState (.auth/user.json not found)`;
const outputFilePath = JSON.stringify(path.resolve(ROOT_DIR, relRecordingPath));
const startUrlJson = JSON.stringify(startUrl);
const scrollFixJson = JSON.stringify(IFRAME_SCROLL_FIX_SCRIPT);

const launcherCode = [
  `'use strict';`,
  `const { chromium } = require(${pwCorePath});`,
  ``,
  `(async () => {`,
  `  const browser = await chromium.launch({ headless: false });`,
  `  const ctxOpts = {`,
  `    viewport: { width: ${vpW}, height: ${vpH} },`,
  `    deviceScaleFactor: 1,`,
  authStorageLine,
  `  };`,
  `  const context = await browser.newContext(ctxOpts);`,
  ``,
  `  // Inject scroll-fix script BEFORE any navigation so every page load`,
  `  // (including AJAX-driven ones) gets the iframe scrollbar fix applied.`,
  `  // This only affects the recorder browser -- NOT automated test runs.`,
  `  await context.addInitScript(${scrollFixJson});`,
  ``,
  `  // Enable the Playwright codegen recorder.`,
  `  // context._enableRecorder() is the same internal API used by`,
  `  // 'npx playwright codegen' -- recording output format is identical.`,
  `  await context._enableRecorder({`,
  `    language: 'playwright-test',`,
  `    outputFile: ${outputFilePath},`,
  `    mode: 'recording',`,
  `    handleSIGINT: false,`,
  `    launchOptions: {},`,
  `    contextOptions: ctxOpts,`,
  `  });`,
  ``,
  `  const page = await context.newPage();`,
  `  await page.goto(${startUrlJson});`,
  ``,
  `  let isClosing = false;`,
  `  async function finishAndExit() {`,
  `    if (isClosing) return;`,
  `    isClosing = true;`,
  `    try { await context.close(); } catch (_) {}`,
  `    try { await browser.close(); } catch (_) {}`,
  `    process.exit(0);`,
  `  }`,
  ``,
  `  function monitorPage(p) {`,
  `    p.on('close', () => {`,
  `      setTimeout(() => {`,
  `        try {`,
  `          const openPages = browser.contexts().flatMap(c => c.pages()).filter(pg => !pg.isClosed());`,
  `          if (openPages.length === 0) finishAndExit();`,
  `        } catch (_) {`,
  `          finishAndExit();`,
  `        }`,
  `      }, 300);`,
  `    });`,
  `  }`,
  ``,
  `  context.on('page', monitorPage);`,
  `  monitorPage(page);`,
  `  browser.on('disconnected', finishAndExit);`,
  `  context.on('close', finishAndExit);`,
  ``,
  `  // Safety heartbeat check: detect when user closes browser window`,
  `  const pollTimer = setInterval(() => {`,
  `    try {`,
  `      const openPages = browser.contexts().flatMap(c => c.pages()).filter(pg => !pg.isClosed());`,
  `      if (openPages.length === 0) {`,
  `        clearInterval(pollTimer);`,
  `        finishAndExit();`,
  `      }`,
  `    } catch (_) {`,
  `      clearInterval(pollTimer);`,
  `      finishAndExit();`,
  `    }`,
  `  }, 1000);`,
  ``,
  `  // Keep process alive until finishAndExit() triggers`,
  `  await new Promise(() => {});`,
  `})().catch((err) => {`,
  `  console.error('[RECORDER ERROR]', err.message);`,
  `  process.exit(1);`,
  `});`,
].join('\n');

const launcherPath = path.join(ROOT_DIR, '.playwright-recorder-launcher.tmp.js');

try {
  fs.writeFileSync(launcherPath, launcherCode, 'utf-8');
} catch (writeErr) {
  console.error(`\n\x1b[31m[ERROR] Could not write launcher temp file: ${writeErr.message}\x1b[0m\n`);
  process.exit(1);
}

const launchResult = safeSpawnSync(process.execPath, [launcherPath], {
  stdio: 'inherit',
  cwd: ROOT_DIR,
});

// Clean up temp file regardless of outcome.
try { fs.unlinkSync(launcherPath); } catch (_) {}

if (launchResult.error) {
  console.error(`\n\x1b[31m[ERROR] Could not start recorder: ${launchResult.error.message}\x1b[0m\n`);
  process.exit(1);
}
if (launchResult.status !== 0) {
  console.error(`\n\x1b[31m[ERROR] Recorder process exited with code ${launchResult.status}\x1b[0m\n`);
  process.exit(launchResult.status || 1);
}

if (!fs.existsSync(fullRecordingPath)) {
  console.warn(`\n\x1b[33m[WARN] Recorder closed but ${relRecordingPath} was not created (no actions recorded?).\x1b[0m`);
  console.warn(`   -> Run "npm run ${RECORD_CMD} ${key}" again and perform at least one action before closing.\n`);
  process.exit(1);
}

console.log(`\n\x1b[32m[OK] Recording saved: ${relRecordingPath}\x1b[0m`);

// Warn (but don't fail) if the recorder was closed without any real interaction.
// Playwright codegen always writes the initial page.goto(...), so a file alone
// is not proof the Tester exercised the flow. auto-test.js applies the same
// check and will refuse to treat an empty recording as Grounding Truth (it
// would otherwise wrongly strip test.fixme() guards), so surface it here too.
const recordedSource = fs.readFileSync(fullRecordingPath, 'utf-8');
const INTERACTION_RE =
  /\.(click|fill|press|check|uncheck|selectOption|setInputFiles|type|dblclick|tap|hover|dragTo|focus)\s*\(|getBy(Role|Label|Placeholder|Text|TestId|Title|AltText)\s*\(/;
if (!INTERACTION_RE.test(recordedSource)) {
  console.warn(`\n\x1b[33m[WARN] This recording has no recorded interactions (only the initial navigation).\x1b[0m`);
  console.warn(`   -> regenerate/auto-test will NOT treat it as Grounding Truth and will NOT remove test.fixme() guards.`);
  console.warn(`   -> Re-run "npm run ${RECORD_CMD} ${key}" and click/fill at least one element before closing the recorder.\n`);
  if (FUNCTION_MODE) {
    // In FUNCTION_MODE the auto-hook (sync-specs + run-function) would launch a browser
    // that immediately closes because there is nothing to run.
    // This flash-and-close confuses testers ("browser opened then vanished") and prints
    // a false [DONE] banner. Exit here with a clear actionable error message instead.
    console.error(`\n\x1b[31m[ERROR] Function recording is empty -- auto-hook ABORTED.\x1b[0m`);
    console.error(`   -> Please re-run: npm run record:function ${key}`);
    console.error(`   -> Perform at least one click/fill inside the ASAP form before closing the Playwright Inspector window.\n`);
    process.exit(1);
  }
}


// --- Auto-save session reminder (if Tester logged in during recording) ---
// If .auth/user.json does NOT exist yet but the recording was saved successfully,
// it means the Tester had to log in manually during codegen. We launch a quick
// headed browser to capture the storageState from the newly-recorded flow so
// subsequent record/test runs skip the SSO form entirely.
if (fs.existsSync(fullRecordingPath)) {
  const AUTH_STORAGE_STATE_OUT = path.join(ROOT_DIR, '.auth', 'user.json');
  if (!fs.existsSync(AUTH_STORAGE_STATE_OUT)) {
    console.log('\x1b[33m[INFO] No .auth/user.json session found -- run `npm run login` to save session for future runs.\x1b[0m');
    console.log('   \x1b[36mTip:\x1b[0m  npm run login');
  }
}
if (FUNCTION_MODE) {
  // -----------------------------------------------------------------
  // AUTO-HOOK (Function Mode): Automatically run sync-specs + verify
  // test after the recorder closes. Tester does NOT need to type any
  // additional commands -- recording -> Page Object -> Spec -> Test
  // all happens in a single uninterrupted pipeline.
  // -----------------------------------------------------------------
  const nodeBin = process.execPath;
  const syncSpecsScript = path.join(__dirname, 'sync-specs.js');
  const mdToSpecScript = path.join(__dirname, 'md-to-spec.js');
  const runFunctionScript = path.join(__dirname, 'run-function.js');

  console.log(`\n[AUTO] Starting automatic sync-specs for: ${key}`);
  console.log(`   -> Generating Page Object and Test Spec from recording...`);

  const syncResult = safeSpawnSync(nodeBin, [syncSpecsScript, key, '--force-pom', '--force-spec', '--force-md'], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
  });

  if (syncResult.error || syncResult.status !== 0) {
    console.warn(`\n[WARN] sync-specs exited with code ${syncResult.status ?? 'N/A'}. Skipping auto-verify step.`);
    console.warn(`   -> Run manually: npm run sync-specs ${key}`);
    process.exit(syncResult.status ?? 1);
  }

  console.log(`\n[AUTO] Compiling Markdown BDD scenarios to executable Playwright spec...`);
  const mdResult = safeSpawnSync(nodeBin, [mdToSpecScript, key], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
  });

  if (mdResult.error || mdResult.status !== 0) {
    console.warn(`\n[WARN] md-to-spec exited with code ${mdResult.status ?? 'N/A'}.`);
  }

  console.log('\n======================================================');
  console.log(` [DONE] Da ghi nhan kich ban Function: ${key}`);
  console.log('======================================================');
  console.log(`  * Recording:   tests/recordings/functions/${key}.recording.ts`);
  console.log(`  * Page Object: tests/pages/functions/...Page.ts`);
  console.log(`  * Test Spec:   tests/e2e/functions/TC-${key}.spec.ts`);
  console.log('\nKhi nao can chay test de tao case tu dong, hay got:');
  console.log(`   npm run test:function ${key}\n`);
  console.log('======================================================\n');
} else {
  console.log(`\n[NEXT] Next step -- regenerate the Page Object + Test Spec grounded in this recording:`);
  console.log(`   npm run regenerate ${key}`);
  console.log(`   (or force it as mandatory grounding: npm run auto-test ${key} -- --ground)\n`);
}
