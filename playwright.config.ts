import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

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

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://demo.playwright.dev/todomvc',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
