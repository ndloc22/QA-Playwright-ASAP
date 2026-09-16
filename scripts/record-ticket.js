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
 *   3. Launches `playwright codegen --target=playwright-test`, which lets the
 *      Tester click through the REAL flow on the REAL app while Playwright
 *      records real, DOM-grounded selectors (no guessing).
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

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const RECORDINGS_DIR = path.join(ROOT_DIR, 'tests', 'recordings');
const AUTH_STORAGE_STATE = path.join(ROOT_DIR, '.auth', 'user.json');

function detectScreenResolution() {
  if (IS_WINDOWS) {
    try {
      // Read physical screen resolution (raw pixels).
      // NOTE: the PowerShell command is broken into concatenated strings to avoid
      // Node.js template-literal / string escaping issues with PS $ variables.
      // Query Width and Height as separate statements to avoid PS variable interpolation
      // issues when spawned from Node.js (\$s.Width literal problem with string concat).
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
          // Read Windows DPI setting (96 = 100 %, 120 = 125 %, 144 = 150 %, 192 = 200 %).
          // AppliedDPI reflects the effective DPI for the current user session.
          let dpi = 96; // default: 100 % scale
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
            // ignore — stay at 96 (100 %)
          }
          // Convert physical pixels -> CSS logical pixels (what Playwright uses).
          // Logical px = Physical px * (96 / AppliedDPI)
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
  // Strip URL query/hash and trailing slashes, then keep only the last path
  // segment (e.g. https://jira/browse/KFWT-1161 -> KFWT-1161).
  value = value.split(/[?#]/)[0].replace(/\/+$/, '');
  const segment = value.split('/').pop();
  // Accept classic ticket keys (KFWT-1161) as well as alphanumeric module
  // names / custom keys (ADMINISTRATION, ASAP-NAVIGATION, ...).
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
console.log(`\n--> A browser window will open. Perform the real flow described in the ticket, then close the`);
console.log(`   Playwright Inspector window to finish -- the recorded script is saved automatically.\n`);

const npxBin = resolveWindowsBinary('npx');
const codegenArgs = [
  'playwright',
  'codegen',
  '--target=playwright-test',
  `--viewport-size=${viewportSize}`,
  `--output=${relRecordingPath}`,
];
if (hasAuthStorage) {
  codegenArgs.push(`--load-storage=${path.relative(ROOT_DIR, AUTH_STORAGE_STATE).split(path.sep).join('/')}`);
}
codegenArgs.push(startUrl);

const result = safeSpawnSync(npxBin, codegenArgs, {
  stdio: 'inherit',
  cwd: ROOT_DIR,
});

if (result.error) {
  console.error(`\n\x1b[31m[ERROR] Could not start Playwright codegen: ${result.error.message}\x1b[0m\n`);
  process.exit(1);
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


// --- Auto-save session after recording (if Tester logged in during codegen) ---
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
  console.log(` [DONE] Đã ghi nhận kịch bản Function: ${key}`);
  console.log('======================================================');
  console.log(`  * Recording:   tests/recordings/functions/${key}.recording.ts`);
  console.log(`  * Page Object: tests/pages/functions/...Page.ts`);
  console.log(`  * Test Spec:   tests/e2e/functions/TC-${key}.spec.ts`);
  console.log('\n👉 Khi nào cần chạy test để tạo case tự động, hãy gõ:');
  console.log(`   npm run test:function ${key}\n`);
  console.log('======================================================\n');
} else {
  console.log(`\n[NEXT] Next step -- regenerate the Page Object + Test Spec grounded in this recording:`);
  console.log(`   npm run regenerate ${key}`);
  console.log(`   (or force it as mandatory grounding: npm run auto-test ${key} -- --ground)\n`);
}
