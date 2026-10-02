/**
 * 🧩 Agent DOM Helpers — lõi dùng chung cho Luồng 1 (test:agent) & Luồng 2 (record:agent)
 *
 * Tách thuần (pure refactor) các helper vốn nằm trong scripts/run-agent.js để cả
 * run-agent.js và record-agent.js dùng chung MỘT nguồn duy nhất — không đổi hành vi:
 *   - collectInteractiveElements(scope)  : chụp danh sách element tương tác được của page/frame.
 *   - parseAiActionJson(text)            : bóc JSON hành động {action,target,value} từ output AI.
 *   - isSsoUrl(url)                      : nhận diện trang SSO/MFA Microsoft.
 *   - resolveBinary(command)             : phân giải tên binary theo PATHEXT (Windows).
 *   - waitAjaxIdle(page)                 : chờ PrimeFaces AJAX-indicator biến mất.
 *   - maximizeWindow(context, page)      : phóng to cửa sổ Chromium qua CDP.
 *   - ssoHandoff(page, context, opts)    : chờ Tester đăng nhập SSO & lưu storageState.
 */

'use strict';

const path = require('path');
const fs = require('fs');

const IS_WINDOWS = process.platform === 'win32';

// Thu thập danh sách các element tương tác được (button, link, input, select,
// textarea, label, option) đang HIỂN THỊ trên một page/frame — kèm tag, text,
// id, class để AI Agent có đủ ngữ cảnh xác định element thay thế.
async function collectInteractiveElements(scope) {
  try {
    return await scope.evaluate(() => {
      const SEL = 'button, a, input, select, textarea, label, option, ' +
        '[role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="link"]';
      const out = [];
      const nodes = Array.from(document.querySelectorAll(SEL)).slice(0, 400);
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        const text = (
          el.innerText || el.value || el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') || el.title || ''
        ).replace(/\s+/g, ' ').trim().slice(0, 80);
        const cls = (typeof el.className === 'string' ? el.className : '').trim().slice(0, 80);
        const item = { tag: el.tagName.toLowerCase(), text };
        const type = el.getAttribute('type');
        if (type) item.type = type;
        if (el.id) item.id = el.id;
        if (cls) item.class = cls;
        if (!text && !el.id) continue;
        out.push(item);
      }
      return out;
    });
  } catch (_) {
    return [];
  }
}

// Parse chuỗi JSON hành động {"action","target","value"} từ output của AI Agent,
// chịu được trường hợp AI trả kèm văn bản / code-fence bao quanh.
function parseAiActionJson(text) {
  if (!text) return null;
  const tryParse = (raw) => {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && obj.action) return obj;
    } catch (_) {}
    return null;
  };

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const hit = tryParse(fence[1].trim());
    if (hit) return hit;
  }

  const objs = text.match(/\{[^{}]*"action"[^{}]*\}/g);
  if (objs) {
    for (let i = objs.length - 1; i >= 0; i--) {
      const hit = tryParse(objs[i]);
      if (hit) return hit;
    }
  }
  return null;
}

function isSsoUrl(url) {
  return /login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|login\.windows\.net|sts\.|\/adfs\/|\/oauth2\//i.test(url);
}

function resolveBinary(command) {
  if (!IS_WINDOWS) return command;
  const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) return `${command}${ext}`;
    }
  }
  return null;
}

// Chờ PrimeFaces AJAX-indicator biến mất (giống hệt các method trong POM) để tránh
// click vào lúc form đang re-render → locator "biến mất" gây timeout.
async function waitAjaxIdle(page) {
  if (!page) return;
  try {
    const ajaxIndicator = page
      .locator('.ajax-status-position, [id*="ajax-indicator-ajax-indicator"]')
      .first();
    await ajaxIndicator.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  } catch (_) {}
}

// Phóng to cửa sổ trình duyệt Chromium (Full màn hình) qua CDP. Nuốt lỗi lặng lẽ
// để không chặn luồng khi chạy headless / môi trường không hỗ trợ.
async function maximizeWindow(context, page) {
  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
  } catch (_) {}
}

// SSO Hand-off: nếu đang ở trang đăng nhập Microsoft Azure AD / MFA, chờ Tester đăng
// nhập thủ công trên cửa sổ trình duyệt (tối đa timeoutMs). Khi quay về app thì lưu
// storageState mới vào authFile. Trả về true nếu đăng nhập thành công.
async function ssoHandoff(page, context, opts = {}) {
  const {
    authFile = null,
    timeoutMs = 120000,
    appUrlFragment = 'bpm-qa.eon.com',
    pollMs = 1500,
  } = opts;

  const deadline = Date.now() + timeoutMs;
  let loggedIn = false;
  while (Date.now() < deadline) {
    if (!isSsoUrl(page.url()) && page.url().includes(appUrlFragment)) {
      loggedIn = true;
      break;
    }
    await page.waitForTimeout(pollMs);
  }

  if (loggedIn && authFile) {
    fs.mkdirSync(path.dirname(authFile), { recursive: true });
    await context.storageState({ path: authFile });
  }
  return loggedIn;
}

module.exports = {
  IS_WINDOWS,
  collectInteractiveElements,
  parseAiActionJson,
  isSsoUrl,
  resolveBinary,
  waitAjaxIdle,
  maximizeWindow,
  ssoHandoff,
};
