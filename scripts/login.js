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
  console.error('\n[ERR] Chua thiet lap BASE_URL trong file .env!\n');
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
    '🔐 DANG NHAP SSO/MFA 1 LAN — LUU SESSION VINH VIEN',
    '',
    '  Dang mo trang: ' + startUrl,
    '',
    '  Neu thay man hinh dang nhap Microsoft:',
    '    👉 Nhap email + mat khau nhu binh thuong.',
    '    👉 Duyet xac thuc MFA tren dien thoai (neu co).',
    '',
    '  ⏱  Thoi gian cho: ' + timeoutSec + 's  (--timeout de thay doi)',
    '',
    '  Script tu dong luu session sau khi vao duoc he thong.',
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
      console.log('✅  Dang nhap thanh cong!');
      console.log('🔐  Session da luu -> .auth/user.json');
      console.log('');
      console.log('  Tu gio cac lenh sau se KHONG hoi lai SSO:');
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
    console.error('\n[ERR] Het ' + timeoutSec + 's ma chua quay lai duoc he thong.');
    console.error('  Tang thoi gian cho bang co --timeout <giay>.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n[ERR]', err.message || err);
  process.exit(1);
});