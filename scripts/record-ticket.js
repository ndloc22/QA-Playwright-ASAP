/**
 * ðŸŽ¥ E.ON Grounding Recorder: Playwright codegen scoped to a Jira ticket key
 * Usage:
 *   npm run record:ticket KFWT-1161
 *   npm run record:ticket -- KFWT-1161 --url /some/deep/link
 *
 * What this does (answers "lÃ m sao Ä‘á»ƒ bÆ°á»›c regenerate tá»± tham chiáº¿u codegen?"):
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
      const psCmd = 'Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "$($s.Width),$($s.Height)"';
      const res = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8', timeout: 3000 });
      if (!res.error && res.stdout) {
        const match = res.stdout.trim().match(/^(\d+),(\d+)$/);
        if (match) {
          return `${match[1]},${match[2]}`;
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
// NhÃ³m 2 (Function/Module) mode: `npm run record:function <NAME>` (which passes
// --function) OR being invoked via the record:function lifecycle event. In this
// mode the recording is grouped under tests/recordings/functions/ so it never
// collides with NhÃ³m 1 (Jira Ticket) recordings, and every downstream tool
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
  console.log('\n\x1b[33m⚡ Usage:\x1b[0m');
  console.log('   \x1b[36mGroup 1 (Jira Ticket):\x1b[0m  npm run record:ticket <TICKET_KEY> [-- --url <path>]');
  console.log('      Example: npm run record:ticket KFWT-1161');
  console.log('   \x1b[36mGroup 2 (Function):\x1b[0m     npm run record:function <FUNCTION_NAME> [-- --url <path>]');
  console.log('      Example: npm run record:function SEARCH_TELECONTROL');
  console.log('\n\x1b[33m🖥️  Viewport (automatic):\x1b[0m auto-scaled to 100% of your primary display (e.g. 2K 2560x1440, Full HD 1920x1080).\n' +
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
  console.warn(`\x1b[33mâš ï¸  .auth/user.json not found -- codegen will start WITHOUT a preloaded login session.\x1b[0m`);
  console.warn(`   -> If the app requires login, sign in manually inside the recorder window, or capture a\n      storageState first (e.g. via Playwright's authentication docs) and save it to .auth/user.json.`);
}

console.log(`\n======================================================`);
console.log(`ðŸŽ¥ RECORDING ${MODE_LABEL} GROUNDING TRUTH FOR \x1b[36m${key}\x1b[0m`);
console.log(`======================================================\n`);
console.log(`ðŸŒ BASE_URL:        ${startUrl}`);
console.log(`ðŸ” Auth session:    ${hasAuthStorage ? '.auth/user.json (preloaded)' : '(none -- will start logged out)'}`);
console.log(`ðŸ“„ Output file:     ${relRecordingPath}`);
const isAuto = (!process.env.CODEGEN_VIEWPORT || process.env.CODEGEN_VIEWPORT === 'auto') &&
  !Object.keys(VIEWPORT_PRESETS).some((f) => argv.includes(f)) &&
  viewportFlagIndex === -1;
console.log(`ðŸ–¥ï¸  Viewport:        ${viewportSize.replace(',', ' x ')}${isAuto ? ' (Tá»± Ä‘á»™ng full theo mÃ n hÃ¬nh mÃ¡y báº¡n)' : ''}`);
console.log(`\nðŸ‘‰ A browser window will open. Perform the real flow described in the ticket, then close the`);
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
  console.error(`\n\x1b[31mâŒ Could not start Playwright codegen: ${result.error.message}\x1b[0m\n`);
  process.exit(1);
}

if (!fs.existsSync(fullRecordingPath)) {
  console.warn(`\n\x1b[33mâš ï¸  Recorder closed but ${relRecordingPath} was not created (no actions recorded?).\x1b[0m`);
  console.warn(`   -> Run "npm run ${RECORD_CMD} ${key}" again and perform at least one action before closing.\n`);
  process.exit(1);
}

console.log(`\n\x1b[32mâœ… Recording saved: ${relRecordingPath}\x1b[0m`);

// Warn (but don't fail) if the recorder was closed without any real interaction.
// Playwright codegen always writes the initial page.goto(...), so a file alone
// is not proof the Tester exercised the flow. auto-test.js applies the same
// check and will refuse to treat an empty recording as Grounding Truth (it
// would otherwise wrongly strip test.fixme() guards), so surface it here too.
const recordedSource = fs.readFileSync(fullRecordingPath, 'utf-8');
const INTERACTION_RE =
  /\.(click|fill|press|check|uncheck|selectOption|setInputFiles|type|dblclick|tap|hover|dragTo|focus)\s*\(|getBy(Role|Label|Placeholder|Text|TestId|Title|AltText)\s*\(/;
if (!INTERACTION_RE.test(recordedSource)) {
  console.warn(`\n\x1b[33mâš ï¸  This recording has no recorded interactions (only the initial navigation).\x1b[0m`);
  console.warn(`   -> regenerate/auto-test will NOT treat it as Grounding Truth and will NOT remove test.fixme() guards.`);
  console.warn(`   -> Re-run "npm run ${RECORD_CMD} ${key}" and click/fill at least one element before closing the recorder.\n`);
}


// --- Auto-save session after recording (if Tester logged in during codegen) ---
// If .auth/user.json does NOT exist yet but the recording was saved successfully,
// it means the Tester had to log in manually during codegen. We launch a quick
// headed browser to capture the storageState from the newly-recorded flow so
// subsequent record/test runs skip the SSO form entirely.
if (fs.existsSync(fullRecordingPath)) {
  const AUTH_STORAGE_STATE_OUT = path.join(ROOT_DIR, '.auth', 'user.json');
  if (!fs.existsSync(AUTH_STORAGE_STATE_OUT)) {
    console.log('\x1b[33m💾 Chua co session .auth/user.json — chay `npm run login` de luu session lan sau khoi dang nhap lai.\x1b[0m');
    console.log('   \x1b[36mTip:\x1b[0m  npm run login');
  }
}
if (FUNCTION_MODE) {
  console.log(`\nâž¡ï¸  Next step -- package the Page Object + starter spec into the functions/ group:`);
  console.log(`   npm run sync-specs ${key}`);
  console.log(`   Then run it: npx playwright test tests/e2e/functions/TC-${key}.spec.ts\n`);
} else {
  console.log(`\nâž¡ï¸  Next step -- regenerate the Page Object + Test Spec grounded in this recording:`);
  console.log(`   npm run regenerate ${key}`);
  console.log(`   (or force it as mandatory grounding: npm run auto-test ${key} -- --ground)\n`);
}
