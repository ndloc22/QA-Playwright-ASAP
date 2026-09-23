/**
 * E.ON Run Function -- execute testcase directly (headed UI) with manual SSO/MFA hand-off.
 *
 * Runs a function's spec in headed mode with interactive SSO fallback.
 *
 * Usage:
 *   npm run test:function SEARCH_TELECONTROL
 *   npm run test:function SEARCH_TELECONTROL -- -g "01"        # filter single scenario
 *   npm run test:function SEARCH_TELECONTROL -- --debug        # step-by-step debug
 *   SSO_TIMEOUT=180000 npm run test:function SEARCH_TELECONTROL  # custom SSO wait
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');

function parseKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  if (!value) return null;
  value = value.split(/[\\/]/).pop().replace(/\.spec\.ts$/i, '').replace(/\.md$/i, '');
  value = value.replace(/^TC-/i, '');
  const match = value.match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
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

function main() {
  const argv = process.argv.slice(2);
  const positional = argv.find((a) => !a.startsWith('-'));
  const passthrough = argv.filter((a) => a !== positional);
  const key = parseKey(positional);

  if (!key) {
    console.log('\n\x1b[33mUsage: npm run test:function <FUNCTION_NAME> [-- <playwright args>]\x1b[0m');
    console.log('   Example: npm run test:function SEARCH_TELECONTROL');
    console.log('            npm run test:function SEARCH_TELECONTROL -- -g "01" --debug\n');
    process.exit(1);
  }

  // Prefer grouped function spec, fallback to flat spec
  const groupedRel = `tests/e2e/functions/TC-${key}.spec.ts`;
  const flatRel = `tests/e2e/TC-${key}.spec.ts`;
  const specRel = fs.existsSync(path.join(ROOT_DIR, groupedRel))
    ? groupedRel
    : fs.existsSync(path.join(ROOT_DIR, flatRel))
      ? flatRel
      : null;

  if (!specRel) {
    console.error(`\n\x1b[31m[ERROR] No test spec found for "${key}" (${groupedRel}).\x1b[0m`);
    console.error(`   -> Generate spec first: npm run sync-specs ${key} then npm run md-to-spec ${key}\n`);
    process.exit(1);
  }

  console.log('======================================================');
  console.log(` [RUN] DIRECT (headed) + SSO hand-off: ${key}`);
  console.log('======================================================');
  console.log(`  * Spec:        ${specRel}`);
  console.log(`  * SSO:         INTERACTIVE_SSO=1 (pauses for manual login if needed)`);
  console.log(`  * Timeout:     ${Math.round((Number(process.env.SSO_TIMEOUT) || 120000) / 1000)}s (override via SSO_TIMEOUT ms)`);
  console.log(`  * Mode:        --headed (browser visible, NOT headless)`);
  if (passthrough.length) console.log(`  * Extra flags: ${passthrough.join(' ')}`);
  console.log('');

  const npxBin = resolveWindowsBinary('npx');
  const args = [
    'playwright',
    'test',
    specRel,
    '--headed',
    '--project=chromium',
    ...passthrough,
  ];

  const result = safeSpawnSync(npxBin, args, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: { ...process.env, INTERACTIVE_SSO: '1' },
  });

  if (result.error) {
    console.error(`\n\x1b[31m[ERROR] Failed to run Playwright: ${result.error.message}\x1b[0m\n`);
    process.exit(1);
  }

  const testPassed = result.status === 0;
  const shouldHeal = argv.includes('--heal') || process.env.AUTO_HEAL === '1';

  if (!testPassed && shouldHeal) {
    console.log('\n\x1b[33m[AI-HEAL] Test failed and --heal active. Triggering AI Healer...\x1b[0m');
    const healScript = path.join(__dirname, 'ai-healer.js');
    const healRes = safeSpawnSync(process.execPath, [healScript, key], {
      stdio: 'inherit',
      cwd: ROOT_DIR,
      env: process.env,
    });
    process.exit(healRes.status ?? 1);
  }

  process.exit(result.status == null ? 1 : result.status);
}

main();
