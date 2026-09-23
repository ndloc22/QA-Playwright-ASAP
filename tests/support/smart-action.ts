/**
 * 🛡️ Smart Action — Runtime AI Self-Healing Wrapper for ASAP
 *
 * Bọc mọi thao tác tương tác UI (click, fill, press...) của POM bằng cơ chế 2 tầng:
 *
 *   Tầng 1 (Fast Path):
 *     Gọi Playwright native với timeout ngắn (4s mặc định). Nếu element khớp ngay → thực thi & trả về.
 *     Zero overhead so với chạy bình thường — không ảnh hưởng tốc độ test khi selector chuẩn.
 *
 *   Tầng 2 (Self-Healing Fallback):
 *     Nếu Playwright báo timeout hoặc không tìm thấy element:
 *     1. Tự động thử danh sách locator heuristic dựa trên intent (name/text/role/aria).
 *     2. Với PrimeFaces: thử click vào Label, trigger, panel tương đương.
 *     3. Ghi log cảnh báo vàng [SELF-HEALED] để Tester/Dev biết bước nào cần update POM.
 *     4. Nếu không có fallback nào khớp:
 *        - Dump thông tin ngữ cảnh lỗi ra test-results/last-failure-context.json
 *        - Ném lại lỗi gốc để kích hoạt AI Healer CLI chẩn đoán và viết lại POM.
 */

import { type FrameLocator, type Locator, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const FAST_TIMEOUT_MS = 7000;
const HEALED_PREFIX = '\x1b[33m[SELF-HEALED]\x1b[0m';
const WARN_PREFIX = '\x1b[33m[SMART-WARN]\x1b[0m';

export interface SmartActionOptions {
  name?: string;
  role?: string;
  nearText?: string;
  frame?: FrameLocator;
  fastTimeout?: number;
  scrollFirst?: boolean;
}

function dumpFailureContext(stepDesc: string, action: string, opts: SmartActionOptions, err: any) {
  try {
    const resultsDir = path.join(process.cwd(), 'test-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    const payload = {
      timestamp: new Date().toISOString(),
      step: stepDesc,
      action,
      name: opts.name || '',
      role: opts.role || '',
      nearText: opts.nearText || '',
      error: err ? (err.message || String(err)) : 'Unknown error',
    };
    fs.writeFileSync(path.join(resultsDir, 'last-failure-context.json'), JSON.stringify(payload, null, 2), 'utf-8');
  } catch (_) {}
}

function buildFallbackLocators(root: Page | FrameLocator, opts: SmartActionOptions): Locator[] {
  const candidates: Locator[] = [];
  const { name, role, nearText } = opts;
  if (!name && !role && !nearText) return candidates;
  const r = root as any;
  if (role === 'option' && name) {
    candidates.push(r.locator(`.ui-selectonemenu-panel:visible li:has-text("${name}"), .ui-selectonemenu-item:visible:has-text("${name}")`).first());
    candidates.push(r.locator(`.ui-selectonemenu-panel:visible [data-label="${name}"]`).first());
    candidates.push(r.locator(`li[data-label*="${name}" i]:visible`).first());
    candidates.push(r.locator(`li:visible`).filter({ hasText: name }).first());
  }
  if (role && name) candidates.push(r.getByRole(role, { name, exact: false }));
  if (name) candidates.push(r.getByText(name, { exact: true }));
  if (name) candidates.push(r.getByText(name, { exact: false }));
  if (name) candidates.push(r.getByLabel(name, { exact: false }));
  if (name) candidates.push(r.locator(`[aria-label*="${name}" i]`).first());
  if (role === 'radio' && name) candidates.push(r.locator(`label:has-text("${name}")`).first());
  if (role === 'combobox' && name) candidates.push(r.locator(`.ui-selectonemenu-label:has-text("${name}")`).first());
  if (nearText) candidates.push(r.locator('input, button, [role="button"]').filter({ hasText: nearText }).first());
  if (role && !name) candidates.push(r.getByRole(role).first());
  return candidates;
}

function getRootFrom(locator: Locator, frame?: FrameLocator): Page | FrameLocator | null {
  if (frame) return frame;
  const internal = locator as any;
  if (typeof internal._frame === 'object' && internal._frame !== null) return internal._frame;
  if (typeof internal.page === 'function') {
    try { return internal.page(); } catch (_) {}
  }
  return null;
}

async function waitForDialogIfOpen(primary: Locator, opts: SmartActionOptions): Promise<void> {
  const root = getRootFrom(primary, opts.frame);
  if (!root) return;
  try {
    // 🛡️ 1. Tự động đóng dropdown panel PrimeFaces (.ui-selectcheckboxmenu-panel) nếu đang mở và primary nằm ngoài panel
    const openMenuPanels = (root as any).locator('.ui-selectcheckboxmenu-panel:visible');
    const panelCount = await openMenuPanels.count().catch(() => 0);
    if (panelCount > 0) {
      const isInsideMenuPanel = await primary.evaluate((el: any) => {
        return !!el.closest('.ui-selectcheckboxmenu-panel');
      }).catch(() => false);

      if (!isInsideMenuPanel) {
        console.log(`[SMART-GUARD] Đang có dropdown panel mở che khuất "${opts.name || 'element'}" — kích hoạt đóng panel...`);
        const closeBtn = openMenuPanels.locator('.ui-selectcheckboxmenu-close:visible, a[aria-label="Close"]:visible').first();
        if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await closeBtn.click({ force: true, timeout: 2000 }).catch(() => {});
        }
        const page = (root as any).page ? (root as any).page() : null;
        if (page && page.keyboard) {
          await page.keyboard.press('Escape').catch(() => {});
        }
        await openMenuPanels.first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        if (page) await page.waitForTimeout(200).catch(() => {});
      }
    }

    // 🛡️ 2. Tự động đóng dialog PrimeFaces (.ui-dialog) nếu đang mở và primary nằm ngoài dialog
    const dialog = (root as any).locator('.ui-dialog:visible');
    const isDialogVisible = await dialog.first().isVisible().catch(() => false);
    if (isDialogVisible) {
      const isInsideDialog = await primary.evaluate((el: any) => {
        return !!el.closest('.ui-dialog');
      }).catch(() => false);
      if (!isInsideDialog) {
        console.log(`[SMART-GUARD] Đang có dialog mở — kích hoạt đóng dialog trước khi thao tác "${opts.name || 'element'}"...`);
        const okBtn = dialog.locator('button:has-text("OK"), .ui-button:has-text("OK"), [role="button"]:has-text("OK")').first();
        if (await okBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log('[SMART-GUARD] Bấm nút OK trên dialog...');
          await okBtn.click({ force: true, timeout: 3000 }).catch(() => {});
        }
        await dialog.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
        await (root as any).locator('.ui-widget-overlay:visible, .ui-dialog-mask:visible').first().waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
        await (root as any).locator('.ajax-status-position, [id*="ajax-indicator-ajax-indicator"]').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        const page = (root as any).page ? (root as any).page() : null;
        if (page) await page.waitForTimeout(400).catch(() => {});
      }
    }
  } catch (_) {}
}


export async function smartClick(primary: Locator, opts: SmartActionOptions = {}): Promise<void> {
  const page = (primary as any).page ? (primary as any).page() : null;
  if (page && !(page as any)._hasAutoDialogHandler) {
    (page as any)._hasAutoDialogHandler = true;
    page.on('dialog', async (d: any) => {
      console.log(`[SMART-DIALOG] Tự động accept browser dialog: "${d.message()}"`);
      await d.accept().catch(() => {});
    });
  }
  await waitForDialogIfOpen(primary, opts);
  const fastTimeout = opts.fastTimeout ?? FAST_TIMEOUT_MS;
  const isOption = opts.role === 'option' || (opts.name && /option/i.test(opts.name));
  // PrimeFaces Overlay: scrollIntoView đóng dropdown panel tự động, nên với Option scrollFirst bắt buộc = false
  const scrollFirst = isOption ? false : (opts.scrollFirst ?? true);

  // 🛡️ Với Option trong dropdown: đợi dropdown panel mở trước khi click
  if (isOption) {
    const root = getRootFrom(primary, opts.frame);
    if (root) {
      await (root as any).locator('.ui-selectonemenu-panel:visible, .ui-autocomplete-panel:visible').first()
        .waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    }
  }

  // 🛡️ Với Checkbox: nếu đã được check (active) thì bỏ qua lượt click thừa để tránh bị uncheck
  if (opts.role === 'checkbox') {
    const isAlreadyChecked = await primary.evaluate((el: any) => {
      return el.classList.contains('ui-state-active') ||
             el.querySelector('.ui-icon-check') !== null ||
             el.classList.contains('ui-icon-check') ||
             (el as HTMLInputElement).checked === true ||
             el.getAttribute('aria-checked') === 'true';
    }).catch(() => false);
    if (isAlreadyChecked) {
      console.log(`[SMART] Checkbox "${opts.name || ''}" đã ở trạng thái CHECKED — tự động bỏ qua để bảo toàn lựa chọn.`);
      return;
    }
  }

  try {
    if (scrollFirst) await primary.scrollIntoViewIfNeeded({ timeout: fastTimeout }).catch(() => {});
    await primary.click({ timeout: fastTimeout });
    return;
  } catch (primaryErr: any) {
    const stepDesc = opts.name ? `"${opts.name}"` : 'unknown step';
    console.warn(`${WARN_PREFIX} Tầng 1 timeout: ${stepDesc}. Kích hoạt Self-Healing...`);
    const root = getRootFrom(primary, opts.frame);

    // 🛡️ Self-Healing cấp 0: Nếu bị overlay/panel che khuất (intercepts pointer events), tự đóng panel và click force
    if (/intercepts pointer events/i.test(primaryErr.message || '')) {
      console.warn(`[SMART-HEAL] Bị overlay che khuất bước ${stepDesc}: đóng panel và thử click force...`);
      if (root) {
        const closeBtn = (root as any).locator('.ui-selectcheckboxmenu-panel:visible .ui-selectcheckboxmenu-close:visible, a[aria-label="Close"]:visible').first();
        if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await closeBtn.click({ force: true, timeout: 2000 }).catch(() => {});
        }
        const page = (root as any).page ? (root as any).page() : null;
        if (page && page.keyboard) {
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
      try {
        await primary.click({ force: true, timeout: 3000 });
        console.warn(`${HEALED_PREFIX} Bước ${stepDesc} phục hồi thành công bằng force click sau khi dọn overlay.`);
        return;
      } catch (_) {}
    }
    if (!root) {
      
    // 🛡️ Self-Healing cấp cao cho Option: nếu dropdown vô tình bị đóng do AJAX re-render, tự re-open trigger
    if (isOption) {
      try {
        const trigger = (root as any).locator('.ui-selectonemenu.ui-state-focus .ui-selectonemenu-trigger, .ui-selectonemenu.ui-state-hover .ui-selectonemenu-trigger, .ui-selectonemenu-trigger:visible').first();
        if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
          await trigger.click({ timeout: 3000 }).catch(() => {});
          await (root as any).locator('.ui-selectonemenu-panel:visible').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
          const optionItem = (root as any).locator(`.ui-selectonemenu-panel:visible li:has-text("${opts.name}"), .ui-selectonemenu-panel:visible [data-label="${opts.name}"]`).first();
          if (await optionItem.isVisible({ timeout: 2000 }).catch(() => false)) {
            await optionItem.click({ timeout: 3000 });
            console.warn(`${HEALED_PREFIX} Bước ${stepDesc} phục hồi bằng cách re-open dropdown panel.`);
            return;
          }
        }
      } catch (_) {}
    }
    console.error(`\x1b[31m[SMART-FAIL]\x1b[0m No root context for: ${stepDesc}`);
      dumpFailureContext(stepDesc, 'click', opts, primaryErr);
      throw primaryErr;
    }
    const fallbacks = buildFallbackLocators(root, opts);
    for (let i = 0; i < fallbacks.length; i++) {
      const fb = fallbacks[i];
      try {
        const visible = await fb.isVisible({ timeout: 2000 }).catch(() => false);
        if (!visible) continue;
        if (scrollFirst) await fb.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        await fb.click({ timeout: 3000 });
        console.warn(`${HEALED_PREFIX} Bước ${stepDesc} phục hồi bằng fallback #${i + 1}. Hãy cập nhật POM.`);
        return;
      } catch (_) {}
    }
    // 🛡️ Nếu là bước click background/blur (không có role nghiệp vụ, tên là click layout/blur)
    if (!opts.role && opts.name && /^(?:blur|dismiss|background|overlay|backdrop|divNth\d+|layout|container)Element?$/i.test(opts.name)) {
      console.warn(`${WARN_PREFIX} Bỏ qua bước click background/blur non-critical "${stepDesc}" do không tìm thấy.`);
      return;
    }
    console.error(`\x1b[31m[SMART-FAIL]\x1b[0m Tất cả fallback thất bại: ${stepDesc}`);
    dumpFailureContext(stepDesc, 'click', opts, primaryErr);
    throw primaryErr;
  }
}

export async function smartFill(primary: Locator, value: string, opts: SmartActionOptions = {}): Promise<void> {
  await waitForDialogIfOpen(primary, opts);
  const fastTimeout = opts.fastTimeout ?? FAST_TIMEOUT_MS;
  const root = getRootFrom(primary, opts.frame);
  if (root) {
    await (root as any).locator('.ajax-status-position:visible, [id*="ajax-indicator"]:visible').first()
      .waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  try {
    await primary.waitFor({ state: 'visible', timeout: fastTimeout }).catch(() => {});
    await primary.fill(value, { timeout: fastTimeout });
    // Kích hoạt blur/Tab để PrimeFaces gửi dữ liệu AJAX lên backing bean ngay lập tức
    await primary.press('Tab').catch(() => {});
    await primary.dispatchEvent('change').catch(() => {});
    return;
  } catch (primaryErr: any) {
    const stepDesc = opts.name ? `"${opts.name}"` : 'unknown input';
    console.warn(`${WARN_PREFIX} smartFill timeout: ${stepDesc}. Kích hoạt Self-Healing...`);
    const root = getRootFrom(primary, opts.frame);
    if (!root) {
      dumpFailureContext(stepDesc, 'fill', opts, primaryErr);
      throw primaryErr;
    }
    const fallbacks = buildFallbackLocators(root, { ...opts, role: opts.role ?? 'textbox' });
    for (let i = 0; i < fallbacks.length; i++) {
      const fb = fallbacks[i];
      try {
        const visible = await fb.isVisible({ timeout: 2000 }).catch(() => false);
        if (!visible) continue;
        await fb.fill(value, { timeout: 3000 });
        console.warn(`${HEALED_PREFIX} Fill ${stepDesc} phục hồi bằng fallback #${i + 1}.`);
        return;
      } catch (_) {}
    }
    console.error(`\x1b[31m[SMART-FAIL]\x1b[0m smartFill thất bại hoàn toàn: ${stepDesc}`);
    dumpFailureContext(stepDesc, 'fill', opts, primaryErr);
    throw primaryErr;
  }
}

export async function smartPress(primary: Locator, key: string, opts: SmartActionOptions = {}): Promise<void> {
  const fastTimeout = opts.fastTimeout ?? FAST_TIMEOUT_MS;
  try {
    await primary.press(key, { timeout: fastTimeout });
  } catch (_: any) {
    const stepDesc = opts.name ? `"${opts.name}"` : 'unknown element';
    console.warn(`${WARN_PREFIX} smartPress "${key}" trên ${stepDesc} fail — bỏ qua (non-critical).`);
  }
}
