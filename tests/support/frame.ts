/**
 * 🧭 Frame & Navigation Guards — rules thực chiến của Tester trở thành cơ chế mặc định
 *
 * Gom các "luật" mà Tester phải tự nhớ khi thao tác tay trên ASAP Portal thành helper
 * dùng chung cho support / POM / runner. Nhờ đó mọi flow sinh tự động đều tuân thủ sẵn:
 *
 *   1. Các màn hình nghiệp vụ nằm trong iframe. Thay vì hard-code `iframe[title="Task frame"]`,
 *      ta ưu tiên tìm frame có URL chứa `de.eon.itsp.riskassessment` (ổn định theo nghiệp vụ,
 *      không phụ thuộc title bản địa hoá), có fallback về title cũ để không hồi quy.
 *   2. Trang task hay đăng ký `beforeunload`. Trước khi điều hướng trong CÙNG tab, ta tự động
 *      chấp nhận dialog (toàn cục) và vô hiệu hoá handler `onbeforeunload` trên mọi frame để
 *      navigation không bị chặn.
 *   3. Giữ nguyên tab/SSO session — luôn điều hướng trên page hiện tại, không mở tab mới.
 *
 * Module ADDITIVE: không phá vỡ chữ ký sẵn có; POM/runner có thể dùng dần.
 */

import { type Page, type Frame, type FrameLocator } from '@playwright/test';

/** URL pattern đặc trưng của các màn hình Risk Assessment trong iframe nghiệp vụ. */
export const TASK_FRAME_URL_PATTERN = 'de.eon.itsp.riskassessment';

/**
 * Selector iframe nghiệp vụ bền vững: ưu tiên khớp URL pattern (`src*=`) của Risk
 * Assessment, fallback về `iframe[title="Task frame"]` (Axon Ivy Portal) để tương thích
 * ngược với mọi recording/POM hiện có.
 */
export const TASK_FRAME_SELECTOR =
  `iframe[src*="${TASK_FRAME_URL_PATTERN}"], iframe[src*="riskassessment"], iframe[title="Task frame"]`;

/**
 * Trả về FrameLocator tới iframe nghiệp vụ theo URL pattern (ưu tiên) + title (fallback).
 * Dùng chung cho POM `get frame()` và các helper khác.
 */
export function resolveTaskFrameLocator(root: Page | FrameLocator): FrameLocator {
  return (root as any).frameLocator(TASK_FRAME_SELECTOR);
}

/**
 * Tìm đúng `Frame` (page.frames()) của màn hình nghiệp vụ theo URL chứa pattern Risk
 * Assessment. Ưu tiên cho runner cần gọi `frame.evaluate(...)` trên đúng DOM.
 * Fallback: frame có URL khớp 'task'/'process', cuối cùng là null (caller tự fallback page).
 */
export function findBusinessFrame(page: Page): Frame | null {
  const frames = page.frames();
  for (const fr of frames) {
    if (fr.url().includes(TASK_FRAME_URL_PATTERN)) return fr;
  }
  for (const fr of frames) {
    if (/riskassessment/i.test(fr.url())) return fr;
  }
  for (const fr of frames) {
    if (/task|process/i.test(fr.url())) return fr;
  }
  return null;
}

/**
 * Đăng ký handler tự động accept MỌI browser dialog (alert / confirm / beforeunload) ở
 * cấp page — idempotent (chỉ gắn một lần cho mỗi page). Gom cơ chế từng rải rác ở POM
 * constructor và smart-action về một chỗ.
 */
export function installDialogAutoAccept(page: Page | null | undefined): void {
  if (!page) return;
  const anyPage = page as any;
  if (anyPage._hasAutoDialogHandler) return;
  anyPage._hasAutoDialogHandler = true;
  page.on('dialog', async (dialog: any) => {
    try {
      console.log('[Auto-Dialog] ' + dialog.type() + ': ' + String(dialog.message()).slice(0, 120));
    } catch (_) {}
    await dialog.accept().catch(() => {});
  });
}

/**
 * Vô hiệu hoá handler `beforeunload` trên page và MỌI frame con, để điều hướng trong cùng
 * tab không bị dialog "Leave site?" chặn lại. An toàn: nuốt mọi lỗi cross-origin.
 */
export async function disableBeforeUnload(page: Page | null | undefined): Promise<void> {
  if (!page) return;
  for (const fr of page.frames()) {
    try {
      await fr.evaluate(() => {
        try {
          (window as any).onbeforeunload = null;
          window.addEventListener(
            'beforeunload',
            (e) => {
              e.stopImmediatePropagation();
            },
            true
          );
        } catch (_) {}
      });
    } catch (_) {}
  }
}

/**
 * Điều hướng AN TOÀN trong cùng tab: bảo đảm dialog auto-accept đã bật, gỡ `beforeunload`
 * trên mọi frame rồi mới `page.goto(url)`. Không mở tab mới → giữ nguyên SSO session.
 */
export async function safeNavigate(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1]
): Promise<Awaited<ReturnType<Page['goto']>>> {
  installDialogAutoAccept(page);
  await disableBeforeUnload(page);
  return page.goto(url, options);
}
