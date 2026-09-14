import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

/*
 * 🔐 Session reuse via storageState.
 * `.auth/user.json` is saved automatically after the first SSO/MFA login
 * (see tests/support/interactive-auth.ts). When present, all tests reuse
 * the stored session — no re-login on every run.
 *
 * INTERACTIVE_SSO=1 (set by `npm run test:function`) enables the "setup"
 * project only when the session file does not yet exist (first run / expired).
 */
const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');
const INTERACTIVE_SSO = process.env.INTERACTIVE_SSO === '1';
const hasAuthState = fs.existsSync(AUTH_FILE);

/*
 * Auto-detect when BASE_URL points to a real/remote server.
 * If real server -> skip webServer (no local mock server needed).
 * webServer is only started when BASE_URL is a local mock (127.0.0.1:3001 / localhost:3001).
 * Default (no BASE_URL set) assumes a remote server, so webServer is skipped.
 */
const resolvedBaseURL = process.env.BASE_URL || 'https://demo.playwright.dev/todomvc';
const isRealServer =
  !resolvedBaseURL.includes('127.0.0.1:3001') &&
  !resolvedBaseURL.includes('localhost:3001');

/*
 * Run tests sequentially by default (single worker, fullyParallel = false)
 * to avoid session conflicts across workers and server overload.
 * Enable parallel execution explicitly via:
 *   - PARALLEL=true env var, or
 *   - --workers flag (e.g. npx playwright test --workers=4)
 */
const parallelRequested =
  process.env.PARALLEL === 'true' ||
  process.argv.some((arg) => arg === '--workers' || arg.startsWith('--workers='));

/*
 * slowMo — paces test execution to produce clear, readable recordings.
 * Playwright runs at "machine speed" by default: clicks, fills, and
 * navigations happen instantly, making videos hard to follow.
 * slowMo inserts a delay (ms) BEFORE each Playwright action, making each
 * step distinct and visible in the recorded video.
 *
 * - Default: 400 ms/action locally (for reviewer-friendly recordings).
 * - Disabled (0 ms) in CI to avoid slowing pipelines.
 * - Override anytime via SLOWMO env var (in ms):
 *     SLOWMO=0    -> full speed
 *     SLOWMO=800  -> slower, for presentation recordings
 */
const slowMo =
  process.env.SLOWMO !== undefined && process.env.SLOWMO !== ''
    ? Math.max(0, Number(process.env.SLOWMO) || 0)
    : process.env.CI
      ? 0
      : 400;

export default defineConfig({
  testDir: './tests/e2e',
  /*
   * Extend timeout when running headed with INTERACTIVE_SSO (tester needs time to approve MFA).
   * - Normal runs: 30 s is enough for automated steps.
   * - INTERACTIVE_SSO=1: 3 min so the tester can receive and approve the MFA prompt.
   */
  timeout: INTERACTIVE_SSO ? 3 * 60 * 1000 : 30 * 1000,
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
     * Full-HD video recording for every test (pass or fail) so testers can review.
     * `size` must match the viewport below; without it Playwright down-scales the
     * video to <=800x800, making text and table data hard to read.
     */
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    // Full-HD viewport so the entire UI and table data fits without scrolling.
    viewport: { width: 1920, height: 1080 },
    // Extended action/navigation timeouts so each step renders clearly on video.
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
    /*
     * Pace each action so the video shows every step distinctly.
     * See slowMo declaration above for override instructions.
     */
    launchOptions: {
      slowMo,
    },
  },
  // Start the local mock server only when BASE_URL points to localhost.
  // Skipped automatically when BASE_URL targets a real server.
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
    // 🔐 Setup project: only runs when INTERACTIVE_SSO=1 AND no session file exists.
    //
    // ⚡ OPTIMIZED: When .auth/user.json exists (session still valid), this step is
    // skipped entirely — saving ~13 s per run. The chromium project loads the stored
    // session directly and jumps straight into the test.
    //
    // When the session expires: ensureAuthenticated() in the Page Object detects the
    // SSO screen, pauses for the tester to log in, saves a fresh .auth/user.json,
    // and continues the test automatically.
    ...(INTERACTIVE_SSO && !hasAuthState
      ? [
          {
            name: 'setup',
            testDir: './tests/support',
            testMatch: /auth\.setup\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1920, height: 1080 },
              storageState: undefined, // Fresh browser — first login required.
            },
          },
        ]
      : []),
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] defaults to 1280x720 and would override the global
        // viewport, so we re-apply 1920x1080 here to keep video at Full-HD resolution.
        viewport: { width: 1920, height: 1080 },
        // Reuse the saved authenticated session (if available).
        storageState: hasAuthState ? AUTH_FILE : undefined,
      },
      // Depend on 'setup' ONLY when no session file exists (first run / file deleted).
      ...(INTERACTIVE_SSO && !hasAuthState ? { dependencies: ['setup'] } : {}),
    },
    // Uncomment to add Firefox and WebKit cross-browser coverage:
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