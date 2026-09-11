/**
 * 🔐 Interactive SSO / MFA Hand-off cho ASAP
 *
 * "ASAP dính authen không tự bypass được" — hệ thống dùng Microsoft Azure AD /
 * SSO (login.microsoftonline.com) và có thể yêu cầu MFA trên điện thoại, nên
 * KHÔNG thể tự điền username/password rồi qua được. Cơ chế dưới đây cho phép:
 *
 *   1. Chạy test TRỰC TIẾP (--headed, KHÔNG chạy ngầm) — Tester nhìn thấy trình duyệt.
 *   2. Khi trình duyệt dừng ở trang đăng nhập SSO/MFA, script CHỜ Tester tự đăng
 *      nhập + xác thực MFA trong thời gian cho phép (mặc định 120s, chỉnh qua
 *      biến môi trường SSO_TIMEOUT tính bằng ms).
 *   3. Ngay khi quay lại được hệ thống ASAP, script TỰ ĐỘNG lưu phiên đăng nhập
 *      vào `.auth/user.json` (storageState) rồi chạy tiếp các bước testcase — các
 *      lần chạy sau tái sử dụng phiên này nên KHÔNG phải đăng nhập lại.
 *
 * Dùng ở 2 nơi:
 *   - tests/support/auth.setup.ts  (Playwright "setup" project, chạy 1 lần đầu run).
 *   - Trong Page Object `ensureAuthenticated()` khi biến INTERACTIVE_SSO=1 được set
 *     (để Tester can thiệp giữa chừng nếu phiên hết hạn).
 */

import { Page, Locator, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/** Đường dẫn lưu storageState (cookies + localStorage) phiên đã đăng nhập. */
export const AUTH_FILE = path.resolve(process.cwd(), '.auth', 'user.json');

export interface InteractiveAuthOptions {
  /** Base URL của ASAP. Mặc định lấy từ process.env.BASE_URL. */
  baseUrl?: string;
  /** Tổng thời gian tối đa chờ Tester đăng nhập/MFA (ms). Mặc định 120000 (SSO_TIMEOUT). */
  timeoutMs?: number;
  /**
   * Locator chứng minh đã quay lại ASAP (vd nút/menu trên dashboard). Nếu cung
   * cấp, script chờ locator này visible thay vì chỉ dựa vào URL — chính xác hơn.
   */
  readyLocator?: Locator;
  /** Có tự lưu .auth/user.json sau khi đăng nhập thành công không. Mặc định true. */
  saveState?: boolean;
}

/** URL có phải trang đăng nhập SSO / IdP bên ngoài ASAP không. */
export function isSsoOrLoginUrl(url: string): boolean {
  return /login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|login\.windows\.net|sts\.|\/adfs\/|\/oauth2\/|\/saml2?\/|okta\.com|auth0\.com|\/signin|\/login\b/i.test(
    url
  );
}

/** Lấy host của 1 URL (an toàn, không ném lỗi). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Trên trang hiện tại có đang hiện form đăng nhập (Azure AD, ADFS hoặc form nội
 * bộ Ivy) không? Dùng để quyết định có cần hand-off cho Tester hay không.
 */
async function isOnLoginScreen(page: Page): Promise<boolean> {
  if (isSsoOrLoginUrl(page.url())) return true;
  const candidates: Locator[] = [
    page.locator('input[type="password"]'),
    page.getByRole('textbox', { name: /email|username|user name|user/i }),
    page.locator('#i0116'), // Azure AD email field id
  ];
  for (const c of candidates) {
    if (await c.first().isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * Chờ trình duyệt quay về ASAP (không còn ở IdP và không còn form login), tối đa
 * timeoutMs. Nếu có readyLocator thì đợi nó visible để chắc chắn app đã sẵn sàng.
 */
async function waitForReturnToApp(
  page: Page,
  baseHost: string,
  timeoutMs: number,
  readyLocator?: Locator
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() > deadline) {
      throw new Error(
        `Interactive SSO timeout sau ${Math.round(timeoutMs / 1000)}s — chưa quay lại được ASAP. ` +
          `Tăng thời gian bằng biến môi trường SSO_TIMEOUT (ms).`
      );
    }
    const url = page.url();
    const backOnApp =
      !isSsoOrLoginUrl(url) && (baseHost === '' || hostOf(url) === baseHost);
    if (backOnApp && !(await isOnLoginScreen(page))) {
      if (readyLocator) {
        const ok = await readyLocator
          .waitFor({ state: 'visible', timeout: Math.min(15000, deadline - Date.now()) })
          .then(() => true)
          .catch(() => false);
        if (ok) return;
      } else {
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        return;
      }
    }
    await page.waitForTimeout(1000);
  }
}

function banner(lines: string[]): void {
  const width = 66;
  const bar = '═'.repeat(width);
  // eslint-disable-next-line no-console
  console.log(`\n╔${bar}╗`);
  for (const l of lines) {
    // eslint-disable-next-line no-console
    console.log('║ ' + l.padEnd(width - 2) + ' ║');
  }
  // eslint-disable-next-line no-console
  console.log(`╚${bar}╝\n`);
}

/** Lưu storageState hiện tại vào .auth/user.json (tạo thư mục nếu chưa có). */
export async function saveStorageState(page: Page): Promise<void> {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
  // eslint-disable-next-line no-console
  console.log(`🔐 Đã lưu phiên đăng nhập → ${path.relative(process.cwd(), AUTH_FILE)} (lần sau khỏi login lại).`);
}

/**
 * Đảm bảo phiên đã đăng nhập ASAP, với HAND-OFF thủ công cho SSO/MFA.
 *
 * - Nếu đã đăng nhập sẵn (nhờ .auth/user.json) → trả về ngay.
 * - Nếu gặp trang SSO/MFA → dừng chờ Tester đăng nhập, rồi lưu .auth/user.json.
 */
export async function ensureInteractiveAuth(
  page: Page,
  options: InteractiveAuthOptions = {}
): Promise<void> {
  const baseUrl = (options.baseUrl || process.env.BASE_URL || '').replace(/\/+$/, '') + '/';
  const timeoutMs =
    options.timeoutMs ?? Math.max(10000, Number(process.env.SSO_TIMEOUT) || 120000);
  const saveState = options.saveState !== false;
  const baseHost = hostOf(baseUrl);

  await page.goto(baseUrl).catch(() => undefined);
  // Cho các redirect client-side kịp chạy (Ivy portal + Azure AD).
  await page.waitForTimeout(1500);

  if (options.readyLocator) {
    const already = await options.readyLocator.isVisible().catch(() => false);
    if (already && !(await isOnLoginScreen(page))) {
      return; // Đã đăng nhập sẵn, không cần hand-off.
    }
  }

  if (!(await isOnLoginScreen(page))) {
    // Không thấy màn hình login → coi như đã authenticated (storageState còn hạn).
    if (options.readyLocator) {
      await options.readyLocator
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => undefined);
    }
    return;
  }

  banner([
    '🔐  CẦN ĐĂNG NHẬP SSO / MFA THỦ CÔNG',
    '',
    '   Trình duyệt đang ở trang đăng nhập (Microsoft SSO / MFA).',
    '   👉 Hãy ĐĂNG NHẬP + xác thực MFA NGAY trên cửa sổ trình duyệt.',
    '',
    `   Thời gian chờ: ${Math.round(timeoutMs / 1000)}s (chỉnh bằng SSO_TIMEOUT).`,
    '   Script sẽ tự chạy tiếp ngay khi quay lại được ASAP.',
  ]);

  await waitForReturnToApp(page, baseHost, timeoutMs, options.readyLocator);

  // eslint-disable-next-line no-console
  console.log('✅ Đã quay lại ASAP — tiếp tục chạy testcase.');
  if (saveState) {
    await saveStorageState(page).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('⚠️  Không lưu được storageState: ' + (e as Error).message);
    });
  }
}

/**
 * Xác nhận đã đăng nhập bằng cách chờ 1 locator "đích" visible; nếu chưa (do hết
 * phiên giữa chừng) thì hand-off cho Tester đăng nhập lại. Tiện gọi từ ensureAuthenticated.
 */
export async function assertAuthenticatedOrHandoff(
  page: Page,
  readyLocator: Locator,
  options: InteractiveAuthOptions = {}
): Promise<void> {
  const visible = await readyLocator.isVisible().catch(() => false);
  if (visible) return;
  await ensureInteractiveAuth(page, { ...options, readyLocator });
  await expect(readyLocator).toBeVisible({ timeout: 15000 });
}
