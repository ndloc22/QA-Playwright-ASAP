/**
 * 🎯 Action Executor — Clean Selector Strategy cho Luồng 2 (record:agent)
 *
 * Nhận "ý định" từ AI ({ action, target, value, ... }) rồi dựng danh sách candidate
 * locator theo THỨ TỰ ƯU TIÊN selector ổn định, thử lần lượt; locator đầu tiên
 * visible + thực thi được chính là nguồn chân lý được ghi vào RecordingTape.
 *
 * Ưu tiên (Clean Selector Strategy):
 *   1. getByRole(role, { name, exact })
 *   2. getByLabel / getByPlaceholder
 *   3. [id="..."] (PrimeFaces id ổn định)
 *   4. getByText(text, { exact })
 *   5. CSS tối giản đã strip ui-state-(hover|active|focus)
 *
 * Guardrail: CHỈ ghi tape khi action THÀNH CÔNG; strip class transient; hạ
 * dblclick→click; frame-aware (prefix contentFrame khi chạy trong task frame);
 * chờ PrimeFaces AJAX idle giữa các action.
 */

'use strict';

const { waitAjaxIdle } = require('./agent-dom');

const DEFAULT_FRAME_SELECTOR = 'iframe[title="Task frame"]';

/** Escape giá trị thành nội dung single-quoted literal. */
function esc(value) {
  return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Nhận diện target là 1 CSS/engine selector (không phải text thuần). */
function looksLikeSelector(t) {
  return /^[.#\[]|>>|:has\(|:nth-|:text\(|>\s|\s>/.test(String(t || ''));
}

/** Strip transient PrimeFaces classes khỏi 1 chuỗi CSS. */
function stripTransient(css) {
  return String(css || '').replace(/\.ui-state-(?:hover|focus|active|highlight)\b/g, '');
}

// ── Candidate builders: mỗi cái trả { expr, loc } hoặc null ──────────────────
function roleCand(root, role, name, exact) {
  if (!role || !name) return null;
  try {
    const loc = root.getByRole(role, { name, exact: !!exact }).first();
    const expr = `.getByRole('${esc(role)}', { name: '${esc(name)}'${exact ? ', exact: true' : ''} })`;
    return { expr, loc };
  } catch (_) {
    return null;
  }
}

function labelCand(root, name, exact) {
  if (!name) return null;
  try {
    const loc = root.getByLabel(name, { exact: !!exact }).first();
    const expr = `.getByLabel('${esc(name)}'${exact ? ', { exact: true }' : ''})`;
    return { expr, loc };
  } catch (_) {
    return null;
  }
}

function placeholderCand(root, name, exact) {
  if (!name) return null;
  try {
    const loc = root.getByPlaceholder(name, { exact: !!exact }).first();
    const expr = `.getByPlaceholder('${esc(name)}'${exact ? ', { exact: true }' : ''})`;
    return { expr, loc };
  } catch (_) {
    return null;
  }
}

function idCand(root, id) {
  if (!id) return null;
  try {
    const sel = `[id="${id}"]`;
    const loc = root.locator(sel).first();
    const expr = `.locator('${esc(sel)}')`;
    return { expr, loc };
  } catch (_) {
    return null;
  }
}

function textCand(root, text, exact) {
  if (!text) return null;
  try {
    const loc = root.getByText(text, { exact: !!exact }).first();
    const expr = `.getByText('${esc(text)}'${exact ? ', { exact: true }' : ''})`;
    return { expr, loc };
  } catch (_) {
    return null;
  }
}

function cssCand(root, css) {
  const clean = stripTransient(css);
  if (!clean) return null;
  try {
    const loc = root.locator(clean).first();
    const expr = `.locator('${esc(clean)}')`;
    return { expr, loc };
  } catch (_) {
    return null;
  }
}

/**
 * Dựng danh sách candidate theo ưu tiên Clean Selector Strategy cho 1 root (frame/page).
 */
function buildCandidates(root, action) {
  const target = String(action.target || '').trim();
  const kind = String(action.action || 'click').toLowerCase();
  const exact = action.exact === true;
  const cands = [];

  // Hint có cấu trúc (nếu AI/caller cung cấp) luôn được ưu tiên tuyệt đối.
  if (action.role && (action.name || target)) {
    cands.push(roleCand(root, action.role, action.name || target, exact));
  }
  if (action.id) {
    cands.push(idCand(root, action.id));
  }
  if (action.label) {
    cands.push(labelCand(root, action.label, exact));
  }
  if (action.placeholder) {
    cands.push(placeholderCand(root, action.placeholder, exact));
  }

  const isSel = looksLikeSelector(target);

  if (target && !isSel) {
    // 1. getByRole theo loại action
    let roles;
    switch (kind) {
      case 'fill':
        roles = ['textbox', 'searchbox', 'spinbutton', 'combobox'];
        break;
      case 'selectoption':
        roles = ['combobox', 'listbox'];
        break;
      case 'check':
      case 'uncheck':
        roles = ['checkbox', 'radio'];
        break;
      default:
        roles = ['button', 'link', 'menuitem', 'tab', 'option', 'gridcell', 'checkbox', 'radio'];
        break;
    }
    for (const r of roles) cands.push(roleCand(root, r, target, exact));
    // 2. getByLabel / getByPlaceholder
    cands.push(labelCand(root, target, exact));
    cands.push(placeholderCand(root, target, exact));
    // 4. getByText
    cands.push(textCand(root, target, exact));
  }

  // 3/5. id-looking hoặc CSS fallback (strip transient).
  if (target) {
    if (isSel) {
      cands.push(cssCand(root, target));
    } else if (/[:._#\[]/.test(target) && !/\s/.test(target)) {
      // target trông giống id/selector dù không bắt đầu bằng ký tự selector.
      cands.push(idCand(root, target));
      cands.push(cssCand(root, target));
    }
  }

  return cands.filter(Boolean);
}

/** Thực thi action trên 1 locator đã resolve. */
async function execAction(loc, kind, value) {
  switch (String(kind).toLowerCase()) {
    case 'fill':
      await loc.fill(String(value == null ? '' : value));
      break;
    case 'selectoption':
      await loc.selectOption(String(value == null ? '' : value));
      break;
    case 'press':
      await loc.press(String(value || 'Enter'));
      break;
    case 'check':
      await loc.check();
      break;
    case 'uncheck':
      await loc.uncheck();
      break;
    case 'dblclick':
    case 'click':
    default:
      await loc.click();
      break;
  }
}

/**
 * Thực thi + ghi băng 1 action do AI đề xuất.
 *
 * @param {object} scope    Frame (task frame) hoặc page nơi thao tác diễn ra.
 * @param {object} page     Page gốc (để waitAjaxIdle + fallback root).
 * @param {object} action   { action, target, value, role?, name?, id?, label?, placeholder?, exact? }
 * @param {RecordingTape} tape  Băng ghi — chỉ push khi action thành công.
 * @param {object} [opts]   { timeout=5000, frameSelector, probeTimeout=3500 }
 * @returns {Promise<{ok:boolean, usedLocatorExpr?:string, inFrame?:boolean, error?:Error}>}
 */
async function perform(scope, page, action, tape, opts = {}) {
  const {
    timeout = 5000,
    probeTimeout = 3500,
    frameSelector = DEFAULT_FRAME_SELECTOR,
  } = opts;

  if (!action || !action.target) {
    return { ok: false, error: new Error('Action thiếu target') };
  }

  // Hạ dblclick → click ngay từ đầu (guardrail).
  const kind = String(action.action || 'click').toLowerCase() === 'dblclick'
    ? 'click'
    : String(action.action || 'click').toLowerCase();
  const value = action.value != null ? String(action.value) : '';

  await waitAjaxIdle(page);

  const roots = [scope];
  if (scope !== page) roots.push(page);

  let lastErr = null;
  for (const root of roots) {
    const inFrame = root !== page;
    const candidates = buildCandidates(root, { ...action, action: kind });
    for (const c of candidates) {
      try {
        // Pre-check nhanh bằng count() để bỏ qua candidate không tồn tại (tránh chờ vô ích).
        const n = await c.loc.count();
        if (!n) continue;
        await c.loc.waitFor({ state: 'visible', timeout: probeTimeout });
        await execAction(c.loc, kind, value);

        // Thành công → ghi băng với locator-expr ĐÚNG đã dùng.
        if (tape) {
          tape.action({
            action: kind,
            locatorExpr: c.expr,
            value,
            inFrame,
            frameSelector,
          });
        }
        await waitAjaxIdle(page);
        return { ok: true, usedLocatorExpr: c.expr, inFrame };
      } catch (err) {
        lastErr = err;
      }
    }
  }

  return { ok: false, error: lastErr || new Error('Không resolve được locator cho action') };
}

module.exports = {
  perform,
  buildCandidates,
  execAction,
  stripTransient,
  looksLikeSelector,
  esc,
  DEFAULT_FRAME_SELECTOR,
};
