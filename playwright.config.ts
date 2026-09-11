import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

/*
 * 🔐 Tái sử dụng phiên đăng nhập (storageState).
 * `.auth/user.json` được lưu tự động sau lần đăng nhập SSO/MFA thủ công đầu tiên
 * (xem tests/support/interactive-auth.ts). Nếu file tồn tại thì mọi test dùng lại
 * để KHÔNG phải đăng nhập lại mỗi lần.
 *
 * INTERACTIVE_SSO=1 (do `npm run test:function` set) bật thêm "setup" project chạy
 * hand-off đăng nhập thủ công 1 lần trước khi các test bắt đầu (chi tiết bên dưới).
 */
const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');
const INTERACTIVE_SSO = process.env.INTERACTIVE_SSO === '1';
const hasAuthState = fs.existsSync(AUTH_FILE);
// Dùng storageState khi đã có file, HOẶC khi bật interactive (setup sẽ tạo file
// trước khi test chạy nhờ project dependency).
const storageState = hasAuthState || INTERACTIVE_SSO ? AUTH_FILE : undefined;


/*
 * Tự động phát hiện khi baseURL trỏ tới server thật (real/remote server).
 * Nếu là server thật -> bỏ qua webServer (không tự bật mock server).
 * Chỉ giữ webServer khi baseURL là mock cục bộ (127.0.0.1:3001 / localhost:3001).
 * Mặc định (không set BASE_URL) ASAP dùng server remote nên webServer sẽ bị bỏ.
 */
const resolvedBaseURL = process.env.BASE_URL || 'https://demo.playwright.dev/todomvc';
const isRealServer =
  !resolvedBaseURL.includes('127.0.0.1:3001') &&
  !resolvedBaseURL.includes('localhost:3001');

/*
 * Mặc định LUÔN chạy TUẦN TỰ (single worker, fullyParallel = false) để tránh
 * mở song song nhiều worker gây xung đột session người dùng và nghẽn server.
 * Chỉ chạy song song khi có yêu cầu tường minh:
 *   - Biến môi trường PARALLEL=true, hoặc
 *   - Truyền cờ CLI --workers (ví dụ: npx playwright test --workers=4)
 */
const parallelRequested =
  process.env.PARALLEL === 'true' ||
  process.argv.some((arg) => arg === '--workers' || arg.startsWith('--workers='));

/*
 * NHỊP ĐỘ THỰC THI (slowMo) — giúp video ghi hình DỄ THEO DÕI.
 * Playwright mặc định thao tác ở "tốc độ máy": gõ phím, click, mở bảng diễn ra tức
 * thì nên tester xem lại video không kịp quan sát từng bước và trạng thái loading.
 * `slowMo` chèn một khoảng nghỉ (ms) TRƯỚC MỖI thao tác Playwright (click, fill,
 * press, selectOption...), khiến mỗi hành động tách bạch, trực quan trên video.
 *
 * - Mặc định 400ms/thao tác khi chạy cục bộ (quay video cho tester xem lại).
 * - Tự động TẮT (0ms) khi chạy CI để không làm chậm pipeline.
 * - Ghi đè linh hoạt qua biến môi trường SLOWMO (đơn vị ms), ví dụ:
 *     SLOWMO=0    -> chạy nhanh tối đa (không giãn nhịp).
 *     SLOWMO=800  -> giãn nhịp chậm hơn nữa cho video thuyết trình.
 */
const slowMo =
  process.env.SLOWMO !== undefined && process.env.SLOWMO !== ''
    ? Math.max(0, Number(process.env.SLOWMO) || 0)
    : process.env.CI
      ? 0
      : 400;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: parallelRequested,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: parallelRequested ? undefined : 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://demo.playwright.dev/todomvc',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    /*
     * Ghi hình FULL-HD, SẮC NÉT và ĐẦY ĐỦ:
     *  - `mode: 'on'` luôn ghi video cho mọi test (kể cả PASS) để tester xem lại.
     *  - `size` được set tường minh 1920x1080 TRÙNG với viewport bên dưới. Nếu không
     *    set `size`, Playwright sẽ thu nhỏ video về khung <=800x800 khiến video mờ,
     *    chữ/dữ liệu bảng khó đọc. Set bằng viewport giúp video nét đúng độ phân giải.
     */
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    // Viewport FULL-HD để hiển thị trọn vẹn giao diện + dữ liệu trên video.
    viewport: { width: 1920, height: 1080 },
    // Nới thời gian chờ action/điều hướng để các bước kịp render rõ ràng trên video.
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    /*
     * Giãn nhịp thực thi để video ghi lại từng thao tác RÕ RÀNG, tránh cảm giác
     * "nhảy cóc" do trình duyệt chạy quá nhanh. Xem giải thích biến `slowMo` ở trên.
     */
    launchOptions: {
      slowMo,
    },
  },
  /* Tự động bật Mock Server khi chạy test cục bộ.
     Khi BASE_URL trỏ tới server thật thì khối webServer sẽ tự động bị bỏ đi. */
  ...(isRealServer
    ? {}
    : {
        webServer: {
          command: 'node demo-server.js',
          url: 'http://127.0.0.1:3001',
          reuseExistingServer: !process.env.CI,
          timeout: 10 * 1000,
        },
      }),
  projects: [
    // 🔐 Setup project: chỉ bật khi INTERACTIVE_SSO=1 (npm run test:function).
    // Chạy hand-off đăng nhập SSO/MFA thủ công 1 lần rồi lưu .auth/user.json.
    ...(INTERACTIVE_SSO
      ? [
          {
            name: 'setup',
            testDir: './tests/support',
            testMatch: /auth\.setup\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1920, height: 1080 },
              // Setup phải bắt đầu ở trạng thái CHƯA đăng nhập để bắt được form SSO.
              storageState: undefined,
            },
          },
        ]
      : []),
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] mặc định 1280x720 và sẽ ghi đè viewport global,
        // nên set lại 1920x1080 ngay sau spread để video/giao diện đạt Full-HD.
        viewport: { width: 1920, height: 1080 },
        // Tái sử dụng phiên đã đăng nhập (nếu có / nếu setup vừa tạo).
        storageState,
      },
      // Chỉ phụ thuộc "setup" khi bật interactive để `npm test` thường không bị chặn.
      ...(INTERACTIVE_SSO ? { dependencies: ['setup'] } : {}),
    },
    // Bat them Firefox va WebKit neu can test da trinh duyet:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
});
