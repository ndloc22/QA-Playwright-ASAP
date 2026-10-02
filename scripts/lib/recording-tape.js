/**
 * 🎞️ Recording Tape — kết xuất file <KEY>.recording.ts theo đúng format codegen
 *
 * Module thuần (pure, unit-test được) cho Luồng 2 (record:agent). Nhiệm vụ: nhận các
 * bước đã THỰC THI THÀNH CÔNG (từ action-executor) rồi dựng ra một file recording.ts
 * BYTE-tương thích với output `npx playwright codegen` / record:ticket, để
 * scripts/sync-specs.js bóc tách ra POM + Spec không cần chỉnh sửa gì.
 *
 * Format tham chiếu: tests/recordings/functions/CREATE_RISK_REQUEST.recording.ts
 *   import { test, expect } from '@playwright/test';
 *   test.use({ deviceScaleFactor, storageState, viewport });
 *   test('test', async ({ page }) => {
 *     await page.goto('...');
 *     await page.locator('iframe[title="Task frame"]').contentFrame().getByRole(...).click();
 *   });
 */

'use strict';

const DEFAULT_FRAME_SELECTOR = 'iframe[title="Task frame"]';

/** Escape 1 giá trị thành single-quoted string literal như codegen (backslash + quote). */
function q(value) {
  return `'${String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Làm sạch locator-expression: loại bỏ các class transient PrimeFaces
 * (ui-state-hover|focus|active|highlight) để selector ổn định khi replay.
 * Giữ nguyên phần còn lại của chuỗi (getByRole / getByLabel / locator(...)).
 */
function cleanLocatorExpr(expr) {
  if (!expr) return '';
  let out = String(expr);
  out = out.replace(/\.ui-state-(?:hover|focus|active|highlight)\b/g, '');
  // Dọn khoảng trắng dư thừa phát sinh sau khi strip class trong chuỗi CSS.
  out = out.replace(/\s{2,}/g, ' ');
  return out;
}

/**
 * Dựng 1 dòng mã codegen-chuẩn từ 1 step đã thực thi thành công.
 * step = { action, locatorExpr, value, inFrame, frameSelector }
 *   - action: click | fill | selectOption | check | uncheck | press | dblclick
 *   - locatorExpr: chuỗi bắt đầu bằng '.' (vd ".getByRole('button', { name: 'Next' })")
 *   - inFrame: true → prefix page.locator(frameSelector).contentFrame()
 * Trả về chuỗi dòng (không newline) hoặc null nếu step không hợp lệ.
 */
function serializeStep(step) {
  if (!step) return null;
  let action = String(step.action || 'click').toLowerCase();
  // Guardrail: hạ dblclick → click (khớp luật extractPomModel) cho POM/Spec ổn định.
  if (action === 'dblclick') action = 'click';

  const locExpr = cleanLocatorExpr(step.locatorExpr || '');
  if (!locExpr) return null;

  const frameSelector = step.frameSelector || DEFAULT_FRAME_SELECTOR;
  const scope = step.inFrame
    ? `page.locator(${q(frameSelector)}).contentFrame()`
    : 'page';

  let call;
  switch (action) {
    case 'fill':
      call = `.fill(${q(step.value)})`;
      break;
    case 'selectoption':
      call = `.selectOption(${q(step.value)})`;
      break;
    case 'press':
      call = `.press(${q(step.value || 'Enter')})`;
      break;
    case 'check':
      call = '.check()';
      break;
    case 'uncheck':
      call = '.uncheck()';
      break;
    case 'click':
    default:
      call = '.click()';
      break;
  }

  return `  await ${scope}${locExpr}${call};`;
}

/** Header byte-tương thích với codegen (deviceScaleFactor → storageState → viewport). */
function buildHeader(meta = {}) {
  const dsf = meta.deviceScaleFactor != null ? meta.deviceScaleFactor : 1;
  const vp = meta.viewport || { width: 2560, height: 1440 };
  const lines = [];
  lines.push("import { test, expect } from '@playwright/test';");
  lines.push('');
  lines.push('test.use({');
  lines.push(`  deviceScaleFactor: ${dsf},`);
  if (meta.storageState) {
    lines.push(`  storageState: ${q(meta.storageState)},`);
  }
  lines.push('  viewport: {');
  lines.push(`    height: ${vp.height},`);
  lines.push(`    width: ${vp.width}`);
  lines.push('  }');
  lines.push('});');
  lines.push('');
  lines.push("test('test', async ({ page }) => {");
  return lines.join('\n');
}

const FOOTER = '});\n';

class RecordingTape {
  constructor(meta = {}) {
    this.meta = meta || {};
    this.lines = [];
  }

  /** Số bước action (không tính goto). */
  get count() {
    return this.lines.length;
  }

  /** Ghi bước mở Portal (entry URL sạch). */
  goto(url) {
    if (!url) return;
    this.lines.push(`  await page.goto(${q(url)});`);
  }

  /** Ghi 1 action đã thực thi thành công. Bỏ qua lặng lẽ nếu step không hợp lệ. */
  action(step) {
    const line = serializeStep(step);
    if (line) this.lines.push(line);
  }

  /** Thêm trực tiếp 1 dòng thô (hiếm dùng — cho dialog handler v.v.). */
  pushRaw(line) {
    if (line) this.lines.push(line);
  }

  /** Kết xuất toàn bộ source file recording.ts. */
  toSource(metaOverride) {
    const meta = { ...this.meta, ...(metaOverride || {}) };
    const header = buildHeader(meta);
    const body = this.lines.length ? this.lines.join('\n') + '\n' : '';
    return `${header}\n${body}${FOOTER}`;
  }
}

module.exports = {
  RecordingTape,
  serializeStep,
  cleanLocatorExpr,
  buildHeader,
  q,
  DEFAULT_FRAME_SELECTOR,
  FOOTER,
};
