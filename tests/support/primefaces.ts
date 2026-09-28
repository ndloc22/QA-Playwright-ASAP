/**
 * 🧩 PrimeFaces Resilient Helpers — Tầng 1 Deterministic Layer cho ASAP
 *
 * Cung cấp các helper tương tác PrimeFaces bền vững (resilient) dùng chung cho POM và
 * smart-action. Mục tiêu: xử lý đúng đặc thù PrimeFaces (dynamic ID, AJAX re-render,
 * native input bị ẩn sau `ui-helper-hidden-accessible`) bằng heuristic có chủ đích —
 * KHÔNG đoán mù, KHÔNG gọi AI.
 *
 * Nguyên tắc:
 *   - Luôn tương tác qua thành phần HIỂN THỊ (label / trigger / panel item) thay vì
 *     native `<input>` bị ẩn.
 *   - Dùng `[id$=":field"]` / `[id*="field"]` cho dynamic ID thay vì id tuyệt đối.
 *   - Chờ AJAX idle (`waitAjaxIdle`) trước & sau mỗi thao tác trọng yếu để tránh race.
 *
 * ⚠️ Đây là module BỔ SUNG. Nó KHÔNG thay đổi public API của các Page Object hiện tại;
 *    POM có thể tuỳ chọn dùng dần mà không phá vỡ chữ ký method sẵn có.
 */

import { type FrameLocator, type Locator, type Page } from '@playwright/test';

export type PfRoot = Page | FrameLocator;

const DEFAULT_TIMEOUT = 7000;
const AJAX_TIMEOUT = 20000;
const PF_PREFIX = '\x1b[36m[PF]\x1b[0m';

function loc(root: PfRoot, selector: string): Locator {
  return (root as any).locator(selector);
}

/**
 * Chờ tất cả AJAX request của PrimeFaces hoàn tất (ajaxStatus spinner ẩn).
 * Gom logic phân tán ở `run-agent.js` và `smart-action.ts` về một chỗ.
 */
export async function waitAjaxIdle(scope: PfRoot | null | undefined, timeout = AJAX_TIMEOUT): Promise<void> {
  if (!scope) return;
  try {
    const indicator = loc(
      scope,
      '.ajax-status-position:visible, [id*="ajax-indicator"]:visible, [id*="ajax-indicator-ajax-indicator"]'
    ).first();
    await indicator.waitFor({ state: 'hidden', timeout }).catch(() => {});
  } catch (_) {}
}

/**
 * Đóng mọi overlay panel PrimeFaces đang mở (selectOneMenu / selectCheckboxMenu /
 * autocomplete) để tránh chúng chặn pointer event của thao tác kế tiếp.
 */
export async function dismissOpenPanels(scope: PfRoot): Promise<void> {
  try {
    const panels = loc(
      scope,
      '.ui-selectonemenu-panel:visible, .ui-selectcheckboxmenu-panel:visible, .ui-autocomplete-panel:visible'
    );
    if (await panels.count().catch(() => 0) > 0) {
      const page = (scope as any).page ? (scope as any).page() : null;
      if (page && page.keyboard) await page.keyboard.press('Escape').catch(() => {});
      await panels.first().waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
    }
  } catch (_) {}
}

export interface SelectOneMenuOptions {
  /** Phần cuối id động của widget, ví dụ ':riskAnswer_0' hoặc 'riskAnswer_0'. */
  idSuffix?: string;
  /** Label hiển thị của widget (fallback khi không có idSuffix). */
  triggerLabel?: string;
  timeout?: number;
}

/**
 * Chọn một mục trong `p:selectOneMenu` theo text hiển thị.
 *
 * Bền với dynamic ID: định vị widget qua `[id$=":<suffix>"]` (nếu cung cấp) hoặc theo
 * label; mở panel qua trigger; chọn item trong panel đang hiển thị theo text.
 */
export async function selectOneMenu(
  scope: PfRoot,
  optionText: string,
  options: SelectOneMenuOptions = {}
): Promise<void> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  await waitAjaxIdle(scope);

  let widget: Locator | null = null;
  if (options.idSuffix) {
    const suffix = options.idSuffix.replace(/^:/, '');
    widget = loc(scope, `[id$="${suffix}"], [id*="${suffix}"]`).first();
  } else if (options.triggerLabel) {
    widget = loc(scope, `.ui-selectonemenu:has(.ui-selectonemenu-label:has-text("${options.triggerLabel}"))`).first();
  }

  const trigger = widget
    ? widget.locator('.ui-selectonemenu-trigger, .ui-selectonemenu-label').first()
    : loc(scope, '.ui-selectonemenu-trigger:visible').first();

  await trigger.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  await trigger.click({ timeout });

  const panel = loc(scope, '.ui-selectonemenu-panel:visible').last();
  await panel.waitFor({ state: 'visible', timeout }).catch(() => {});

  const item = panel
    .locator(`.ui-selectonemenu-item, li[data-label], li[role="option"]`)
    .filter({ hasText: optionText })
    .first();
  await item.click({ timeout });
  await waitAjaxIdle(scope);
  console.log(`${PF_PREFIX} selectOneMenu -> "${optionText}"`);
}

export interface SelectCheckboxMenuOptions {
  idSuffix?: string;
  triggerLabel?: string;
  timeout?: number;
}

/**
 * Chọn (tick) một hoặc nhiều mục trong `p:selectCheckboxMenu` (multiselect dropdown).
 */
export async function selectCheckboxMenu(
  scope: PfRoot,
  optionLabels: string | string[],
  options: SelectCheckboxMenuOptions = {}
): Promise<void> {
  const labels = Array.isArray(optionLabels) ? optionLabels : [optionLabels];
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  await waitAjaxIdle(scope);

  let widget: Locator | null = null;
  if (options.idSuffix) {
    const suffix = options.idSuffix.replace(/^:/, '');
    widget = loc(scope, `[id$="${suffix}"], [id*="${suffix}"]`).first();
  } else if (options.triggerLabel) {
    widget = loc(scope, `.ui-selectcheckboxmenu:has(.ui-selectcheckboxmenu-label:has-text("${options.triggerLabel}"))`).first();
  }

  const trigger = widget
    ? widget.locator('.ui-selectcheckboxmenu-trigger, .ui-selectcheckboxmenu-label').first()
    : loc(scope, '.ui-selectcheckboxmenu-trigger:visible').first();

  await trigger.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  await trigger.click({ timeout });

  const panel = loc(scope, '.ui-selectcheckboxmenu-panel:visible').last();
  await panel.waitFor({ state: 'visible', timeout }).catch(() => {});

  for (const label of labels) {
    const row = panel.locator('li.ui-selectcheckboxmenu-item').filter({ hasText: label }).first();
    const box = row.locator('.ui-chkbox-box').first();
    const target = (await box.count().catch(() => 0)) > 0 ? box : row;
    const isChecked = await target.evaluate((el: any) => {
      return el.classList.contains('ui-state-active') || el.querySelector('.ui-icon-check') !== null;
    }).catch(() => false);
    if (!isChecked) {
      await target.click({ timeout });
      console.log(`${PF_PREFIX} selectCheckboxMenu -> tick "${label}"`);
    }
  }

  // Đóng panel để không chắn thao tác kế tiếp.
  const closeBtn = panel.locator('.ui-selectcheckboxmenu-close:visible, a[aria-label="Close"]:visible').first();
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click({ force: true, timeout: 2000 }).catch(() => {});
  } else {
    await dismissOpenPanels(scope);
  }
  await waitAjaxIdle(scope);
}

export interface RadioOptions {
  timeout?: number;
}

/**
 * Chọn radio button PrimeFaces theo label hiển thị.
 * PrimeFaces ẩn native `<input type=radio>` sau `ui-helper-hidden-accessible`, nên ta
 * tương tác qua label hoặc `.ui-radiobutton-box` hiển thị.
 */
export async function radio(scope: PfRoot, label: string, options: RadioOptions = {}): Promise<void> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  await waitAjaxIdle(scope);

  const candidates: Locator[] = [
    loc(scope, `label:has-text("${label}")`).first(),
    loc(scope, `.ui-radiobutton-label:has-text("${label}")`).first(),
    loc(scope, `tr:has-text("${label}") .ui-radiobutton-box, .ui-radiobutton:near(:text("${label}")) .ui-radiobutton-box`).first(),
  ];

  for (const c of candidates) {
    if (await c.isVisible({ timeout: 1500 }).catch(() => false)) {
      await c.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
      await c.click({ timeout });
      await waitAjaxIdle(scope);
      console.log(`${PF_PREFIX} radio -> "${label}"`);
      return;
    }
  }
  throw new Error(`[PF] radio: không tìm thấy radio với label "${label}"`);
}

export interface CheckboxOptions {
  /** true = đảm bảo được tick, false = đảm bảo bỏ tick. Mặc định true. */
  checked?: boolean;
  timeout?: number;
}

/**
 * Tick/untick checkbox PrimeFaces theo label hiển thị (idempotent).
 */
export async function checkbox(scope: PfRoot, label: string, options: CheckboxOptions = {}): Promise<void> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const desired = options.checked ?? true;
  await waitAjaxIdle(scope);

  const box = loc(
    scope,
    `.ui-chkbox:has(~ label:has-text("${label}")) .ui-chkbox-box, tr:has-text("${label}") .ui-chkbox-box, label:has-text("${label}")`
  ).first();

  const isChecked = await box.evaluate((el: any) => {
    const scopeEl = el.closest('.ui-chkbox') || el.parentElement || el;
    const b = scopeEl.querySelector ? (scopeEl.querySelector('.ui-chkbox-box') || el) : el;
    return b.classList.contains('ui-state-active') ||
      b.querySelector?.('.ui-icon-check') !== null ||
      b.classList.contains('ui-icon-check');
  }).catch(() => false);

  if (isChecked !== desired) {
    await box.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await box.click({ timeout });
    await waitAjaxIdle(scope);
    console.log(`${PF_PREFIX} checkbox -> "${label}" = ${desired}`);
  }
}
