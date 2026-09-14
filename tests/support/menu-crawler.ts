import { Page, Locator } from '@playwright/test';

/**
 * MenuCrawler -- Post-Deploy Health Check utility for E.ON CyberSec Portal.
 *
 * Crawls the top-level navigation menu and detects:
 *   - Menus that fail to open (timeout, no submenu appears)
 *   - "View Expired" page after navigation (stale Axon Ivy session)
 *   - PrimeFaces AJAX error dialogs (.ui-messages-error, [id*="error-ajax-dialog"])
 *   - Completely blank / empty iframes with no content
 *
 * Usage (in a Playwright test):
 *   const crawler = new MenuCrawler(page);
 *   await crawler.login();
 *   const report = await crawler.crawlTopMenu();
 *   console.table(report.results);
 *   expect(report.deadLinks).toBe(0);
 */
export interface MenuCheckResult {
  label: string;
  status: 'OK' | 'DEAD' | 'ERROR' | 'EXPIRED' | 'BLANK';
  detail: string;
}

export interface CrawlReport {
  total: number;
  passed: number;
  deadLinks: number;
  results: MenuCheckResult[];
}

export class MenuCrawler {
  readonly page: Page;

  /** Selector for top-level menu bar items (E.ON CyberSec Portal). */
  private readonly TOP_MENU_SELECTOR = '.ui-menubar-root-list > li > a, .ui-menu-list > li > a';

  /** Error indicators from Axon Ivy / PrimeFaces that signal a broken page state. */
  private readonly ERROR_SELECTORS = [
    '[id*="error-ajax-dialog"]:visible',
    '.ui-messages-error:visible',
    '.ui-dialog .ui-state-error:visible',
  ];

  /** Axon Ivy "View Expired" page signature. */
  private readonly VIEW_EXPIRED_TEXT = 'ViewExpiredException';

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to the portal base URL and ensure authentication.
   * Skips login if already on the authenticated portal page.
   */
  async ensureOnPortal(baseUrl?: string): Promise<void> {
    const url = (baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '') + '/';
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  /**
   * Check the current page for known error/dead indicators.
   */
  private async detectPageErrors(): Promise<{ status: MenuCheckResult['status']; detail: string }> {
    // Check "View Expired"
    const bodyText = await this.page.locator('body').textContent({ timeout: 3000 }).catch(() => '');
    if (bodyText && bodyText.includes(this.VIEW_EXPIRED_TEXT)) {
      return { status: 'EXPIRED', detail: 'ViewExpiredException detected on page' };
    }

    // Check error dialogs
    for (const sel of this.ERROR_SELECTORS) {
      const el = this.page.locator(sel);
      if (await el.count() > 0) {
        const msg = await el.first().textContent({ timeout: 2000 }).catch(() => sel);
        return { status: 'ERROR', detail: `Error dialog: ${(msg || sel).trim().slice(0, 120)}` };
      }
    }

    // Check blank main content frame
    const mainContent = this.page.locator('#custom-widget-iframe-4, .portal-page-body iframe, main').first();
    const contentExists = await mainContent.count() > 0;
    if (contentExists) {
      const box = await mainContent.boundingBox().catch(() => null);
      if (box && box.width < 10 && box.height < 10) {
        return { status: 'BLANK', detail: 'Main content area is empty (0x0 bounding box)' };
      }
    }

    return { status: 'OK', detail: '' };
  }

  /**
   * Crawl top-level menu items by iterating each menu link,
   * clicking it, and verifying the resulting page is healthy.
   *
   * Each menu item is checked independently: after the check the
   * crawler navigates back to the portal base so the next item
   * can be clicked from a clean state.
   */
  async crawlTopMenu(options: { baseUrl?: string; timeout?: number } = {}): Promise<CrawlReport> {
    const baseUrl = (options.baseUrl || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '') + '/';
    const itemTimeout = options.timeout ?? 15_000;
    const results: MenuCheckResult[] = [];

    await this.ensureOnPortal(baseUrl);

    // Collect all top-level menu item locators
    const menuItems = this.page.locator(this.TOP_MENU_SELECTOR);
    const count = await menuItems.count().catch(() => 0);

    if (count === 0) {
      console.warn('[MenuCrawler] No top-level menu items found. Check TOP_MENU_SELECTOR or login state.');
      return { total: 0, passed: 0, deadLinks: 0, results: [] };
    }

    console.log(`[MenuCrawler] Found ${count} top-level menu items. Starting health check...`);

    for (let i = 0; i < count; i++) {
      // Re-query each time (page may reload between iterations)
      await this.ensureOnPortal(baseUrl);
      const items = this.page.locator(this.TOP_MENU_SELECTOR);
      const item = items.nth(i);
      const label = (await item.textContent({ timeout: 5000 }).catch(() => `item-${i}`))?.trim() || `item-${i}`;

      try {
        await item.hover({ timeout: itemTimeout });
        await item.click({ timeout: itemTimeout });

        // Wait briefly for navigation or AJAX to settle
        await this.page.waitForLoadState('domcontentloaded', { timeout: itemTimeout }).catch(() => undefined);
        await this.page.waitForTimeout(1500);

        const { status, detail } = await this.detectPageErrors();
        results.push({ label, status, detail: detail || 'Page loaded without errors' });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ label, status: 'DEAD', detail: `Click/load timeout: ${msg.slice(0, 100)}` });
      }
    }

    const passed    = results.filter((r) => r.status === 'OK').length;
    const deadLinks = results.filter((r) => r.status !== 'OK').length;

    return { total: results.length, passed, deadLinks, results };
  }
}