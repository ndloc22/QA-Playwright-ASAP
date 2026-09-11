/**
 * 🔐 Playwright "setup" project — Interactive SSO / MFA hand-off (chạy 1 lần đầu run).
 *
 * File này CHỈ được kích hoạt khi biến môi trường INTERACTIVE_SSO=1 (xem
 * playwright.config.ts). Lệnh `npm run test:function <NAME>` tự set biến này +
 * chạy --headed để Tester tự đăng nhập.
 *
 * Luồng:
 *   1. Mở ASAP tại BASE_URL trong cửa sổ trình duyệt hiển thị (--headed).
 *   2. Nếu gặp trang Microsoft SSO / MFA → CHỜ Tester đăng nhập thủ công (SSO_TIMEOUT).
 *   3. Lưu phiên vào .auth/user.json → mọi test project sau đó tái sử dụng (storageState),
 *      không phải đăng nhập lại.
 *
 * Nếu .auth/user.json còn hạn, bước này qua nhanh (không hỏi gì).
 */

import { test as setup } from '@playwright/test';
import { ensureInteractiveAuth } from './interactive-auth';

// Cho phép chờ Tester đăng nhập/MFA lâu hơn timeout mặc định của test.
setup.setTimeout(Math.max(180000, Number(process.env.SSO_TIMEOUT) || 0) + 60000);

setup('interactive SSO hand-off (đăng nhập ASAP thủ công)', async ({ page }) => {
  await ensureInteractiveAuth(page);
});
