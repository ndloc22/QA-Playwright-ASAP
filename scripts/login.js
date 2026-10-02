/**
 * login.js -- One-time interactive SSO/MFA login + flexible environment switch.
 *
 * Saves authenticated storageState to .auth/user.json (active session) so
 * subsequent codegen and test runs skip login entirely. When an environment
 * alias is used, a per-env copy is also kept (.auth/user.<env>.json) so
 * switching back and forth never forces a re-login.
 *
 * Usage:
 *   npm run login                      (dùng BASE_URL hiện tại trong .env)
 *   npm run login dev                  (chuyển sang môi trường alias "dev")
 *   npm run login qa1                  (chuyển sang môi trường alias "qa1")
 *   npm run login https://host/app     (đăng nhập thẳng vào 1 URL bất kỳ)
 *   npm run login -- --url /deep/path  (bắt đầu từ URL sâu hơn)
 *   npm run login -- --timeout 180     (chờ tối đa 180s)
 *
 * Alias môi trường được định nghĩa trong config/environments.json.
 * Mỗi lần chuyển môi trường, BASE_URL trong .env được TỰ ĐỘNG SYNC lại để các
 * lệnh sau (test:function, record:function, qa...) dùng đúng môi trường.
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { chromium } = require('@playwright/test');

dotenv.config();

const ROOT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const ENVIRONMENTS_FILE = path.join(ROOT_DIR, 'config', 'environments.json');
const DEFAULT_AUTH_FILE = path.join(ROOT_DIR, '.auth', 'user.json');

// --- Parse CLI args ---
const argv = process.argv.slice(2);

function getFlag(flag, defaultValue) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return defaultValue;
}

// First non-flag argument = environment alias or full URL (optional).
function getPositional() {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-')) {
      // Skip the flag's value for value-taking flags.
      if (a === '--url' || a === '--timeout') i++;
      continue;
    }
    return a;
  }
  return '';
}

function isUrl(value) {
  return /^https?:\/\//i.test(value);
}

function loadEnvironments() {
  try {
    const raw = JSON.parse(fs.readFileSync(ENVIRONMENTS_FILE, 'utf8'));
    return raw.environments || {};
  } catch {
    return {};
  }
}

// Rewrite (or append) a KEY=value line in .env, preserving everything else.
function syncEnvVar(key, value) {
  let content = '';
  try { content = fs.readFileSync(ENV_FILE, 'utf8'); } catch { content = ''; }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(content)) {
    content = content.replace(re, line);
  } else {
    content += (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
  }
  fs.writeFileSync(ENV_FILE, content, 'utf8');
}

const positional = getPositional();
const environments = loadEnvironments();

let envAlias = '';
let startUrl = '';

if (positional && isUrl(positional)) {
  // Direct full URL (ad-hoc environment).
  startUrl = positional.replace(/\/+$/, '');
} else if (positional) {
  // Environment alias lookup (case-insensitive).
  const key = Object.keys(environments).find((k) => k.toLowerCase() === positional.toLowerCase());
  if (!key) {
    const available = Object.keys(environments).join(', ') || '(none defined)';
    console.error(`\n[ERR] Unknown environment alias: "${positional}"`);
    console.error(`  Available aliases: ${available}`);
    console.error(`  Or pass a full URL, e.g. npm run login https://host/app\n`);
    process.exit(1);
  }
  envAlias = key;
  startUrl = String(environments[key].baseUrl || '').replace(/\/+$/, '');
} else {
  // No positional -> use current BASE_URL from .env.
  startUrl = (process.env.BASE_URL || '').replace(/\/+$/, '');
}

if (!startUrl) {
  console.error('\n[ERR] No target URL. Set BASE_URL in .env or pass an alias/URL.\n');
  process.exit(1);
}

// Sync BASE_URL in .env so every subsequent command uses this environment.
syncEnvVar('BASE_URL', startUrl);

// Per-environment session file: keep a copy so switching back skips re-login.
const AUTH_FILE = envAlias
  ? path.join(ROOT_DIR, '.auth', `user.${envAlias}.json`)
  : DEFAULT_AUTH_FILE;

const extraPath = getFlag('--url', '');
const timeoutSec = parseInt(getFlag('--timeout', '180'), 10);

if (extraPath) {
  startUrl += (extraPath.startsWith('/') ? extraPath : '/' + extraPath);
}

function isSsoOrLoginUrl(url) {
  return /login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|login\.windows\.net|sts\.|\/adfs\/|\/oauth2\/|\/saml2?\/|okta\.com|auth0\.com|\/signin|\/login\b/i.test(url);
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}

function banner(lines) {
  const width = 68;
  const bar = '='.repeat(width);
  console.log('\n' + bar);
  for (const l of lines) console.log('| ' + l);
  console.log(bar + '\n');
}

async function main() {
  banner([
    '[AUTH] 1-CLICK SSO/MFA LOGIN -- SAVE REUSABLE SESSION',
    '',
    '  Environment: ' + (envAlias ? envAlias.toUpperCase() : '(BASE_URL in .env)'),
    '  Opening URL: ' + startUrl,
    '  .env synced: BASE_URL updated automatically',
    '',
    '  If Microsoft SSO login appears:',
    '    * Enter your email & password as usual.',
    '    * Approve MFA on your phone (if prompted).',
    '',
    '  Timeout: ' + timeoutSec + 's  (use --timeout <sec> to adjust)',
    '',
    '  Session will be saved automatically once logged in.',
  ]);

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({
    viewport: null,
    locale: 'vi-VN',
  });
  const page = await context.newPage();

  await page.goto(startUrl).catch(() => {});
  await page.waitForTimeout(2000);

  const baseHost = hostOf(startUrl);
  const deadline = Date.now() + timeoutSec * 1000;

  let saved = false;
  while (Date.now() < deadline) {
    const url = page.url();
    const onSso = isSsoOrLoginUrl(url);
    const onApp = !onSso && (baseHost === '' || hostOf(url) === baseHost);

    if (onApp) {
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const authDir = path.dirname(AUTH_FILE);
      if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
      await context.storageState({ path: AUTH_FILE });
      // Always refresh the active session file so every command picks it up.
      if (AUTH_FILE !== DEFAULT_AUTH_FILE) {
        fs.copyFileSync(AUTH_FILE, DEFAULT_AUTH_FILE);
      }
      saved = true;

      console.log('');
      console.log('[OK] Login successful!');
      if (envAlias) {
        console.log('[OK] Environment -> ' + envAlias.toUpperCase() + ' (.env BASE_URL synced)');
        console.log('[OK] Session saved -> .auth/user.' + envAlias + '.json (+ active user.json)');
      } else {
        console.log('[OK] Session saved -> .auth/user.json');
      }
      console.log('');
      console.log('  Subsequent commands will reuse this session without re-login:');
      console.log('    npm run record:function <NAME>');
      console.log('    npm run record:agent    <NAME>');
      console.log('    npm run test:function   <NAME>');
      console.log('    npm run qa              <KEY>');
      console.log('');
      break;
    }

    await page.waitForTimeout(1000);
  }

  await browser.close();

  if (!saved) {
    console.error('\n[ERR] Timeout after ' + timeoutSec + 's without completing login.');
    console.error('  Increase timeout via: --timeout <seconds>\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[ERR]', err.message || err);
  process.exit(1);
});
