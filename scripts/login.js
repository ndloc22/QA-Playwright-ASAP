/**
 * 🔐 login.js — Đăng nhập SSO/MFA 1 lần, lưu session dùng lại vĩnh viễn
 * =========================================================================
 * Giải quyết vấn đề: "mỗi lần chạy lại bị hỏi đăng nhập SSO miết" — Tester
 * chỉ cần chạy lệnh này 1 LẦN DUY NHẤT. Script sẽ mở trình duyệt Chrome
 * hiện lên, Tester đăng nhập tay (kể cả MFA điện thoại), rồi tắt cửa sổ.
 * Session được lưu tự động vào .auth/user.json — các lệnh record/test sau
 * đó tải lại file này nên KHÔNG BAO GIỜ phải đăng nhập lại (trừ khi token
 * Microsoft hết hạn nhiều ngày sau).
 *
 * Sử dụng:
 *   npm run login
 *   npm run login -- --url /some/deep/path   (bắt đầu từ đường dẫn sâu)
 *   npm run login -- --timeout 180            (tăng thời gian chờ lên 180s)
 */

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { chromium } = require('@playwright/test');

dotenv.config();

const ROOT_DIR = path.join(__dirname, '..');
const AUTH_FILE = path.join(ROOT_DIR, '.auth', 'user.json');

// --- Parse CLI args ---
const argv = process.argv.slice(2);

function getFlag(flag, defaultValue) {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return defaultValue;
}

const extraPath = getFlag('--url', '');
const timeoutSec = parseInt(getFlag('--timeout', '180'), 10);

let startUrl = (process.env.BASE_URL || '').replace(/\/+$/, '');
if (!startUrl) {
  console.error('\n[ERR] BASE_URL is not set in .env file!\n');
  process.exit(1);
}
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
    '🔐 1-CLICK SSO/MFA LOGIN — SAVE REUSABLE SESSION',
    '',
    '  Opening URL: ' + startUrl,
    '',
    '  If Microsoft SSO login appears:',
    '    👉 Enter your email & password as usual.',
    '    👉 Approve MFA on your phone (if prompted).',
    '',
    '  ⏱  Timeout: ' + timeoutSec + 's  (use --timeout <sec> to adjust)',
    '',
    '  Session will be saved automatically once logged in.',
  ]);

  const { chromium } = require('@playwright/test');
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
      saved = true;

      console.log('');
      console.log('✅  Login successful!');
      console.log('🔐  Session saved -> .auth/user.json');
      console.log('');
      console.log('  Subsequent commands will reuse this session without re-login:');
      console.log('    npm run record:ticket  <KEY>');
      console.log('    npm run record:function <NAME>');
      console.log('    npm run test:function  <NAME>');
      console.log('    npx playwright test    ...');
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