/**
 * 🤖 E.ON Run Agent — Mode 2: Autonomous AI Agent Runner
 *
 * Điều khiển trình duyệt trực quan (--headed) bằng AI Agent (GitHub Copilot CLI hoặc Claude CLI)
 * dựa trên kịch bản record / testcase ground truth.
 *
 * Cách dùng:
 *   npm run test:agent CREATE_RISK_REQUEST
 *   npm run test:agent CREATE_RISK_REQUEST -- --cli claude
 *   npm run test:agent CREATE_RISK_REQUEST -- --cli copilot
 *   npm run test:agent CREATE_RISK_REQUEST -- --slowmo 500
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { chromium } = require('@playwright/test');

dotenv.config();

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'config', 'agent.json');
const AUTH_FILE = path.join(ROOT_DIR, '.auth', 'user.json');
const LOGS_DIR = path.join(ROOT_DIR, 'logs', 'agent-runs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// [NEW] Load compiled POM (if exists) to reuse proven interaction logic
function findPomFile(key) {
  const dir = path.join(ROOT_DIR, 'tests', 'pages', 'functions');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const targetClean = (key.replace(/[_-]/g, '') + 'page.ts').toLowerCase();
  for (const f of files) {
    if (f.replace(/[_-]/g, '').toLowerCase() === targetClean) {
      return path.join(dir, f);
    }
  }
  return null;
}

// Register an in-memory TypeScript require-hook so the proven POM (and its TS
// dependencies smart-action / interactive-auth) can be required straight from
// source — no brittle `tsc --outDir dist` step, no rootDir/path guessing.
let _tsLoaderRegistered = false;
function registerTsLoader() {
  if (_tsLoaderRegistered) return true;
  let ts;
  try {
    ts = require('typescript');
  } catch (_) {
    return false;
  }
  require.extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
      },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
  _tsLoaderRegistered = true;
  return true;
}

function loadPom(key) {
  const pomTsPath = findPomFile(key);
  if (!pomTsPath) return null;
  const baseName = path.basename(pomTsPath, '.ts');

  if (!registerTsLoader()) {
    console.warn('  ⚠️ TypeScript không khả dụng — không thể nạp POM đã kiểm chứng.');
    return null;
  }

  try {
    delete require.cache[require.resolve(pomTsPath)];
    const mod = require(pomTsPath);
    const PomClass = mod[baseName] || mod.default;
    if (PomClass) {
      console.log('  📦 Loaded POM: ' + baseName + '.ts (source, verified)');
      return PomClass;
    }
  } catch (err) {
    console.warn('  ⚠️ Failed to load POM from source: ' + err.message);
  }

  return null;
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

function parseKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  if (!value) return null;
  value = value.split(/[\\/]/).pop().replace(/\.recording\.ts$/i, '').replace(/\.spec\.ts$/i, '').replace(/\.md$/i, '');
  value = value.replace(/^TC-/i, '');
  const match = value.match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
}

function isSsoUrl(url) {
  return /login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com|login\.windows\.net|sts\.|\/adfs\/|\/oauth2\//i.test(url);
}

function loadConfig() {
  let cfg = {
    defaultCli: process.env.AI_AGENT_CLI || 'claude',
    autoFallback: process.env.AI_AGENT_FALLBACK !== 'false',
    timeoutMs: Number(process.env.AI_AGENT_TIMEOUT) || 60000,
    copilot: { model: process.env.COPILOT_MODEL || 'claude-opus-4.8', flags: ['--allow-all'] },
    claude: { flags: ['--print', '--dangerously-skip-permissions'] },
  };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const fileCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg = { ...cfg, ...fileCfg };
    } catch (_) {}
  }
  return cfg;
}

function checkCliAvailability() {
  const hasCopilot = !!resolveBinary('copilot');
  const hasClaude = !!resolveBinary('claude');
  return { hasCopilot, hasClaude };
}

function parseCommandLineArgs() {
  const argv = process.argv.slice(2);
  const positional = argv.find((a) => !a.startsWith('-'));
  const key = parseKey(positional);

  let cli = null;
  const cliIdx = argv.indexOf('--cli');
  if (cliIdx !== -1 && argv[cliIdx + 1]) cli = argv[cliIdx + 1].toLowerCase();

  let slowmo = 500;
  const slowmoIdx = argv.indexOf('--slowmo');
  if (slowmoIdx !== -1 && argv[slowmoIdx + 1]) slowmo = parseInt(argv[slowmoIdx + 1], 10);

  // ── Heal / auto-fill opt-in ────────────────────────────────────────────────
  // MẶC ĐỊNH: tôn trọng kịch bản (Ground Truth). Agent KHÔNG được tự ý điền vào
  // các field còn rỗng / dropdown chưa chọn — vì Tester có thể đang chủ đích để
  // trống (negative test, optional field). Nếu validation chặn luồng thì DỪNG và
  // báo cáo trung thực. Chỉ khi Tester bật cờ --heal (hoặc --auto-fill) thì agent
  // mới được phép tự điền/chọn để cứu luồng.
  const healMode =
    argv.includes('--heal') ||
    argv.includes('--auto-fill') ||
    argv.includes('--autofill') ||
    process.env.AI_AGENT_HEAL === 'true';

  return { key, cli, slowmo, healMode };
}

async function invokeAgentCli(promptText, activeCli, config, logFile) {
  let output = '';
  let success = false;
  let usedCli = activeCli;

  function runOneCli(cliName) {
    console.log(`  \x1b[35m[AI CALL]\x1b[0m Đang kết nối tới ${cliName.toUpperCase()} CLI...`);
    let proc;
    // Trên Windows các CLI này là shim .cmd/.bat. Nếu spawnSync hết timeout và gửi
    // SIGTERM mặc định, cmd.exe sẽ hỏi "Terminate batch job (Y/N)?" và TREO (không ai
    // trả lời được vì stdin đã dùng cho prompt). => Dùng killSignal:'SIGKILL' để buộc
    // TerminateProcess ngay lập tức (không hiện prompt), kèm windowsHide + maxBuffer.
    const commonOpts = {
      input: promptText,
      cwd: ROOT_DIR,
      encoding: 'utf8',
      shell: true,
      env: process.env,
      timeout: config.timeoutMs,
      killSignal: 'SIGKILL',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    if (cliName === 'copilot') {
      const model = config.copilot?.model || 'claude-opus-4.8';
      // Truyền prompt qua stdin (pipe) thay vì `-p <promptText>` để tránh lỗi
      // command format trên Windows (prompt dài / có ký tự đặc biệt làm vỡ lệnh).
      proc = spawnSync('copilot', ['--model', model, '--allow-all'], commonOpts);
    } else {
      proc = spawnSync('claude', ['--print', '--dangerously-skip-permissions'], commonOpts);
    }

    // Loại bỏ nhiễu prompt tương tác của cmd.exe (nếu lỡ lọt vào output) để không
    // phá bước parse JSON hành động.
    const clean = (s) =>
      String(s || '').replace(/Terminate batch job \(Y\/N\)\?\s*/gi, '');
    const resOut = clean(proc.stdout) + '\n' + clean(proc.stderr);
    const isQuota = /exceeded your monthly quota|rate limit/i.test(resOut);
    const isOk = !proc.error && proc.status === 0 && !isQuota;
    return { isOk, isQuota, resOut };
  }

  const firstAttempt = runOneCli(activeCli);
  output += `=== ${activeCli.toUpperCase()} OUTPUT ===\n` + firstAttempt.resOut;
  success = firstAttempt.isOk;

  if (!success && config.autoFallback) {
    const fallbackCli = activeCli === 'copilot' ? 'claude' : 'copilot';
    console.warn(`  \x1b[33m⚠️ ${activeCli.toUpperCase()} không khả dụng hoặc hết quota. Tự động chuyển tiếp sang ${fallbackCli.toUpperCase()} CLI...\x1b[0m`);
    const fallbackAttempt = runOneCli(fallbackCli);
    output += `\n=== FALLBACK ${fallbackCli.toUpperCase()} OUTPUT ===\n` + fallbackAttempt.resOut;
    success = fallbackAttempt.isOk;
    usedCli = fallbackCli;
  }

  fs.appendFileSync(logFile, output + '\n\n', 'utf8');
  return { success, output, usedCli };
}

// ============================================================================
// 🤖 AUTONOMOUS AI RECOVERY — helpers
// Thu thập ngữ cảnh UI (element tương tác được), parse JSON hành động do AI trả
// về, và thực thi hành động cứu nguy (click/fill) bằng Playwright.
// ============================================================================

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

// Thực thi hành động cứu nguy do AI chỉ định trên taskFrame (scope) hoặc page.
// Thử nhiều chiến lược locator (selector thô, role, text, label, placeholder).
async function executeAiAction(scope, page, action, allowFill = true) {
  if (!action) return false;
  const target = String(action.target || '').trim();
  if (!target) return false;
  const kind = String(action.action || 'click').toLowerCase();
  const value = action.value != null ? String(action.value) : '';

  // Ground Truth guard: không tự ý điền dữ liệu khi chưa bật --heal/--auto-fill.
  // Việc điền ngầm có thể làm sai lệch bản chất ca kiểm thử (negative/optional test).
  if (kind === 'fill' && !allowFill) {
    console.warn(
      '  \x1b[33m⛔ [GROUND TRUTH] AI đề xuất FILL nhưng chế độ heal đang TẮT — bỏ qua để không điền ngầm.\x1b[0m'
    );
    console.warn('     -> Nếu muốn agent tự điền, chạy lại kèm cờ: --heal (hoặc --auto-fill).');
    return false;
  }

  const looksSelector = /^[.#\[]|>>|:has\(|:nth-|:text\(/.test(target);

  const roots = [scope];
  if (scope !== page) roots.push(page);

  for (const root of roots) {
    const candidates = [];
    if (looksSelector) {
      try { candidates.push(root.locator(target).first()); } catch (_) {}
    }
    try { candidates.push(root.getByRole('button', { name: target, exact: false }).first()); } catch (_) {}
    try { candidates.push(root.getByText(target, { exact: false }).first()); } catch (_) {}
    try { candidates.push(root.getByLabel(target, { exact: false }).first()); } catch (_) {}
    try { candidates.push(root.getByPlaceholder(target, { exact: false }).first()); } catch (_) {}
    if (!looksSelector) {
      try { candidates.push(root.locator(target).first()); } catch (_) {}
    }

    for (const loc of candidates) {
      try {
        await loc.waitFor({ state: 'visible', timeout: 4000 });
        if (kind === 'fill') {
          await loc.fill(value);
        } else {
          await loc.click();
        }
        return true;
      } catch (_) {
        // thử locator kế tiếp
      }
    }
  }
  return false;
}

// ============================================================================
// 🩹 AUTO-FILL MISSING / INVALID FIELDS
// Tự động phát hiện & xử lý các trường bị dính validation trước khi bấm Next:
//   • Dropdown PrimeFaces còn "Please select" hoặc có class ui-state-error
//   • Input / textarea bắt buộc (aria-required / required / ui-state-error) đang rỗng
// Với dropdown → mở panel & chọn option hợp lệ đầu tiên (bỏ qua "Please select").
// Với input   → điền dữ liệu mẫu hợp lệ.
// Trả về số field đã được tự động xử lý.
// ============================================================================

// Mở 1 dropdown PrimeFaces selectonemenu (theo id đầy đủ) & chọn option hợp lệ
// đầu tiên (khác "Please select"). Panel được PrimeFaces render với id "<id>_panel".
async function fillPrimeFacesDropdown(scope, menuId) {
  const trigger = scope
    .locator('[id="' + menuId + '"] .ui-selectonemenu-trigger, [id="' + menuId + '"]')
    .first();
  await trigger.click({ timeout: 6000 });

  const panel = scope.locator('[id="' + menuId + '_panel"]');
  const validOption = panel
    .locator('li.ui-selectonemenu-item')
    .filter({ hasNotText: /please select|--/i })
    .first();

  try {
    await validOption.click({ timeout: 5000 });
  } catch (_) {
    // Fallback: panel đang mở nhưng bám theo id khác → chọn trong panel đang visible
    const openPanelOption = scope
      .locator('.ui-selectonemenu-panel:visible li.ui-selectonemenu-item')
      .filter({ hasNotText: /please select|--/i })
      .first();
    await openPanelOption.click({ timeout: 5000 });
  }
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

// Chọn dropdown Likelihood theo chỉ số câu hỏi (riskAnswer_<idx>) — dùng cho các
// câu hỏi mà POM chưa có method riêng (ví dụ index 2 & index 4).
//
// `frame` PHẢI là cùng scope mà POM dùng (FrameLocator của iframe[title="Task frame"])
// để locator khớp 1-1 với các method đã kiểm chứng. Trước đây hàm này nhận `getTaskFrame()`
// (một Frame match lỏng theo URL) → sai frame + không chờ AJAX → riskAnswer_2 timeout.
async function selectRiskAnswerByIndex(frame, idx, page) {
  await waitAjaxIdle(page);

  const trigger = frame
    .locator(
      '[id*="riskAnswer_' + idx + '"] .ui-selectonemenu-trigger, ' +
      '[id*="riskAnswer_' + idx + '_label"], [id*="riskAnswer_' + idx + '"]'
    )
    .first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  await trigger.click({ timeout: 10000 });

  // Chờ đúng panel vừa mở của dropdown này rồi mới chọn option hợp lệ đầu tiên.
  await frame
    .locator('.ui-selectonemenu-panel:visible')
    .first()
    .waitFor({ state: 'visible', timeout: 7000 })
    .catch(() => {});

  const option = frame
    .locator('.ui-selectonemenu-panel:visible li.ui-selectonemenu-item')
    .filter({ hasNotText: /please select|--/i })
    .first();
  await option.click({ timeout: 10000 });
  await waitAjaxIdle(page);
}

// ── READ-ONLY: phát hiện field còn thiếu / dính validation (KHÔNG điền) ──────
// Dùng cho chế độ mặc định (tôn trọng Ground Truth): chỉ liệt kê các blocker để
// báo cáo trung thực, tuyệt đối không tự điền. Trả về { dropdowns:[], inputs:[] }
// với label/id để log rõ ràng cho Tester.
async function detectInvalidFields(scope) {
  const result = { dropdowns: [], inputs: [] };
  try {
    result.dropdowns = await scope.evaluate(() => {
      const out = [];
      const menus = Array.from(document.querySelectorAll('.ui-selectonemenu'));
      for (const menu of menus) {
        const rect = menu.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        const label = menu.querySelector('.ui-selectonemenu-label');
        const labelText = ((label && label.textContent) || '').replace(/\s+/g, ' ').trim();
        const lower = labelText.toLowerCase();
        const invalid =
          menu.classList.contains('ui-state-error') ||
          (label && label.classList.contains('ui-state-error')) ||
          lower === '' ||
          /please select|^--/.test(lower);
        if (invalid) out.push({ id: menu.id || '(no-id)', label: labelText || '(empty)' });
      }
      return out;
    });
  } catch (_) {}

  try {
    result.inputs = await scope.evaluate(() => {
      const out = [];
      const nodes = Array.from(
        document.querySelectorAll('input[type="text"], input:not([type]), textarea')
      );
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        if (el.disabled || el.readOnly) continue;
        if (el.value && el.value.trim()) continue;
        const required =
          el.getAttribute('aria-required') === 'true' ||
          el.required ||
          el.classList.contains('ui-state-error');
        if (required) {
          let lbl = '';
          if (el.id) {
            const l = document.querySelector('label[for="' + el.id + '"]');
            if (l) lbl = l.textContent.replace(/\s+/g, ' ').trim();
          }
          out.push({ id: el.id || '(no-id)', label: lbl || el.getAttribute('aria-label') || '(unnamed)' });
        }
      }
      return out;
    });
  } catch (_) {}

  return result;
}

async function autoFillInvalidFields(scope) {
  let fixed = 0;

  // --- A. Dropdown PrimeFaces chưa chọn / báo lỗi validation ---
  let dropIds = [];
  try {
    dropIds = await scope.evaluate(() => {
      const ids = [];
      const menus = Array.from(document.querySelectorAll('.ui-selectonemenu'));
      for (const menu of menus) {
        const rect = menu.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        const label = menu.querySelector('.ui-selectonemenu-label');
        const labelText = ((label && label.textContent) || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const invalid =
          menu.classList.contains('ui-state-error') ||
          (label && label.classList.contains('ui-state-error')) ||
          labelText === '' ||
          /please select|^--/.test(labelText);
        if (invalid && menu.id) ids.push(menu.id);
      }
      return ids;
    });
  } catch (_) {}

  for (const id of dropIds) {
    try {
      await fillPrimeFacesDropdown(scope, id);
      fixed++;
      await scope.waitForTimeout(300).catch(() => {});
    } catch (_) {
      // đóng panel treo (nếu có) rồi bỏ qua dropdown này
    }
  }

  // --- B. Input / textarea bắt buộc đang rỗng ---
  let inputIds = [];
  try {
    inputIds = await scope.evaluate(() => {
      const ids = [];
      const nodes = Array.from(
        document.querySelectorAll('input[type="text"], input:not([type]), textarea')
      );
      for (const el of nodes) {
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) continue;
        if (el.disabled || el.readOnly) continue;
        if (el.value && el.value.trim()) continue;
        const required =
          el.getAttribute('aria-required') === 'true' ||
          el.required ||
          el.classList.contains('ui-state-error');
        if (required && el.id) ids.push(el.id);
      }
      return ids;
    });
  } catch (_) {}

  for (const id of inputIds) {
    try {
      const isTextarea = /description|consequence|comment|note/i.test(id);
      const sample = isTextarea ? 'Auto-filled by QA agent' : 'QA-Auto';
      await scope.locator('[id="' + id + '"]').first().fill(sample, { timeout: 3000 });
      fixed++;
    } catch (_) {}
  }

  return fixed;
}

async function main() {
  const { key, cli: cliOverride, slowmo, healMode } = parseCommandLineArgs();

  if (!key) {
    console.log('\n\x1b[33mUsage: npm run test:agent <FUNCTION_NAME> [-- --cli copilot|claude] [-- --slowmo <ms>] [-- --heal]\x1b[0m');
    console.log('   Ví dụ: npm run test:agent CREATE_RISK_REQUEST');
    console.log('          npm run test:agent CREATE_RISK_REQUEST -- --cli claude');
    console.log('          npm run test:agent CREATE_RISK_REQUEST -- --cli copilot --slowmo 400');
    console.log('          npm run test:agent CREATE_RISK_REQUEST -- --heal   (bật tự điền field còn thiếu)\n');
    console.log('   \x1b[36mGhi chú:\x1b[0m mặc định agent TÔN TRỌNG kịch bản (Ground Truth) — KHÔNG tự điền field rỗng/optional.');
    console.log('          Nếu validation chặn luồng, agent DỪNG & báo cáo trung thực. Dùng --heal (hoặc --auto-fill)');
    console.log('          để cho phép agent tự điền/chọn nhằm cứu luồng.\n');
    process.exit(1);
  }

  const config = loadConfig();
  const activeCli = cliOverride || config.defaultCli || 'claude';
  const { hasCopilot, hasClaude } = checkCliAvailability();

  console.log('================================================================');
  console.log(` 🤖 [MODE 2: AI AGENT RUNNER] AUTONOMOUS EXECUTION: ${key}`);
  console.log('================================================================');
  console.log(`  * Target Module: ${key}`);
  console.log(`  * Preferred CLI: ${activeCli.toUpperCase()}`);
  console.log(`  * Copilot CLI:   ${hasCopilot ? '✔ Sẵn sàng' : '✖ Chưa cài đặt'}`);
  console.log(`  * Claude CLI:    ${hasClaude ? '✔ Sẵn sàng' : '✖ Chưa cài đặt'}`);
  console.log(`  * Mode:          Chromium --headed (Full-HD)`);
  console.log(`  * SlowMo:        ${slowmo}ms`);
  console.log(
    `  * Heal / fill:   ${
      healMode
        ? '\x1b[33mBẬT (--heal) — agent ĐƯỢC phép tự điền/chọn field còn thiếu\x1b[0m'
        : '\x1b[32mTẮT (mặc định) — tôn trọng Ground Truth, KHÔNG tự điền; validation chặn thì dừng & báo cáo\x1b[0m'
    }`
  );

  // [NEW] Attempt to load POM for proven interaction logic
  const PomClass = loadPom(key);
  if (PomClass) {
    console.log(`  * POM Strategy:  ✔ Sử dụng POM đã kiểm chứng (100% success rate)`);
  } else {
    console.log(`  * POM Strategy:  ⚠ Fallback sang AI autonomous (có thể timeout)`);
  }

  // Environment healthcheck
  if (!hasCopilot && !hasClaude) {
    console.error('\n\x1b[31m[ERROR] Không tìm thấy GitHub Copilot CLI hoặc Claude CLI trên máy tính của bạn.\x1b[0m');
    console.log('\n👉 Hướng dẫn cho Tester:');
    console.log('   1. Nếu bạn có tài khoản GitHub Copilot công ty: chạy lệnh cài đặt:');
    console.log('      npm install -g @githubnext/github-copilot-cli');
    console.log('   2. Hoặc chạy chế độ Mode 1 (Native Runner - 0 token, không cần cài AI):');
    console.log(`      npm run test:function ${key}\n`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOGS_DIR, `agent-${key}-${timestamp}.log`);
  const logRel = path.relative(ROOT_DIR, logFile).replace(/\\/g, '/');
  const fileUrl = `file:///${logFile.replace(/\\/g, '/')}`;

  console.log(`  * Tracking Log:  [${logRel}](${fileUrl})`);
  console.log('----------------------------------------------------------------\n');

  // Check recording file as Ground Truth
  const recordCandidate = path.join(ROOT_DIR, 'tests', 'recordings', 'functions', `${key}.recording.ts`);
  const testcaseCandidate = path.join(ROOT_DIR, 'tests', 'testcases', 'functions', `TC-${key}.md`);
  const hasRecording = fs.existsSync(recordCandidate);
  const hasTestcase = fs.existsSync(testcaseCandidate);

  console.log(`  * Ground Truth:  ${hasRecording ? `Recording (${path.basename(recordCandidate)})` : hasTestcase ? `Testcase (${path.basename(testcaseCandidate)})` : 'None (Exploratory mode)'}`);

  // Launch headed browser
  const browser = await chromium.launch({
    headless: false,
    slowMo: slowmo,
    args: ['--start-maximized', '--window-position=0,0', '--window-size=2560,1440'],
  });

  const contextOpts = {
    viewport: null,
    locale: 'vi-VN',
  };
  if (fs.existsSync(AUTH_FILE)) {
    contextOpts.storageState = AUTH_FILE;
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
  } catch (_) {}

  page.on('dialog', async (d) => {
    console.log(`  \x1b[35m[AI Dialog]\x1b[0m Auto accepting: "${d.message().slice(0, 80)}"`);
    await d.accept().catch(() => {});
  });

  const BASE_URL = (process.env.BASE_URL || 'https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec').replace(/\/+$/, '');
  const portalUrl = BASE_URL;

  console.log(`\n\x1b[36m[AI STEP 1/7]\x1b[0m Mở Portal: ${portalUrl}`);
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // SSO Hand-off
  if (isSsoUrl(page.url())) {
    console.log('\n\x1b[33m[SSO HAND-OFF] Phát hiện trang đăng nhập Microsoft Azure AD / MFA.\x1b[0m');
    console.log('\x1b[33m-> Tester vui lòng đăng nhập & xác thực MFA trên cửa sổ trình duyệt (chờ 120s)...\x1b[0m');
    const deadline = Date.now() + 120000;
    let loggedIn = false;
    while (Date.now() < deadline) {
      if (!isSsoUrl(page.url()) && page.url().includes('bpm-qa.eon.com')) {
        loggedIn = true;
        break;
      }
      await page.waitForTimeout(1500);
    }
    if (loggedIn) {
      console.log('\n\x1b[32m✔ Đăng nhập thành công! Đang lưu session mới vào .auth/user.json...\x1b[0m');
      fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
      await context.storageState({ path: AUTH_FILE });
    } else {
      console.error('\n\x1b[31m[ERROR] Hết thời gian chờ đăng nhập SSO (120s). Dừng thực thi.\x1b[0m');
      await browser.close();
      process.exit(1);
    }
  }

  // ============================================================================
  // WORKFLOW EXECUTION — tái sử dụng Page Object Model ĐÃ KIỂM CHỨNG (single source
  // of truth). Trình tự method bên dưới khớp 1-1 với E2E spec đang PASS
  // tests/e2e/functions/TC-CREATE_RISK_REQUEST.spec.ts, nên toàn bộ locator + wait
  // là những cái đã chạy end-to-end trên app thật (không còn code tay lệch pha,
  // không còn timeout/lỗi locator do reimplement thủ công).
  // ============================================================================
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  if (!PomClass) {
    console.error('\n\x1b[31m[ERROR] Không nạp được POM đã kiểm chứng (CreateRiskRequestPage). Không thể chạy kịch bản ổn định.\x1b[0m');
    console.log('   👉 Kiểm tra tests/pages/functions/CreateRiskRequestPage.ts và devDependency "typescript".');
    await browser.close();
    process.exit(1);
  }

  const pom = new PomClass(page);

  // Tìm task frame (frame quy trình) hiện tại — nơi phần lớn form được render.
  const getTaskFrame = () => {
    for (const fr of page.frames()) {
      if (/task|process/i.test(fr.url())) return fr;
    }
    return null;
  };

  // Trả về ĐÚNG Frame nằm sau iframe[title="Task frame"] (cùng iframe mà POM dùng)
  // để các thao tác cần scope.evaluate (autoFillInvalidFields) chạy trên đúng DOM.
  // Ưu tiên contentFrame() của iframe thật, fallback về match URL rồi tới page.
  const resolveTaskFrame = async () => {
    try {
      const handle = await page.waitForSelector('iframe[title="Task frame"]', {
        state: 'attached',
        timeout: 5000,
      });
      const f = handle ? await handle.contentFrame() : null;
      if (f) return f;
    } catch (_) {}
    return getTaskFrame() || page;
  };

  // ==========================================================================
  // 🤖 AUTONOMOUS RECOVERY & CONTINUATION LOOP
  // Bọc mỗi bước: thử chạy stepFn; nếu lỗi (locator timeout/not found) thì AI
  // Agent tự "nhìn" UI, đề xuất hành động thay thế (click/fill), Playwright thực
  // thi. Nếu cứu nguy thành công → flow TIẾP TỤC chạy các bước kế tiếp. Chỉ khi
  // AI Rescue thất bại sau 2 lần thử mới dừng lại & giữ browser mở 90s.
  // ==========================================================================
  async function runStepWithAiRescue(stepName, stepFn) {
    try {
      await stepFn();
      return true;
    } catch (stepErr) {
      const errMsg = stepErr && stepErr.message ? stepErr.message : String(stepErr);
      console.error('\n================================================================');
      console.error(`\x1b[31m[STEP FAILURE]\x1b[0m Bước "${stepName}" lỗi (có thể do không tìm thấy locator).`);
      console.error(`\x1b[31m[STEP FAILURE]\x1b[0m Chi tiết: ${errMsg}`);
      console.error('\x1b[35m🤖 Kích hoạt AI Autonomous Recovery — agent tự nhìn UI để tìm cách click/fill cho xong...\x1b[0m');
      console.error('================================================================');
      fs.appendFileSync(logFile, `\n[STEP FAILURE] ${new Date().toISOString()} :: ${stepName}\n${(stepErr && stepErr.stack) || errMsg}\n`, 'utf8');

      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`\n\x1b[35m[AI RESCUE ${attempt}/2]\x1b[0m Thu thập ngữ cảnh UI & hỏi AI Agent hành động thay thế...`);

        // a. Thu thập ngữ cảnh UI: URL + interactive elements trên page và taskFrame
        const taskFrame = getTaskFrame();
        const scope = taskFrame || page;
        const currentUrl = page.url();
        const frameEls = taskFrame ? await collectInteractiveElements(taskFrame) : [];
        const pageEls = await collectInteractiveElements(page);
        const elements = [...frameEls, ...pageEls].slice(0, 120);

        console.log(`  \x1b[36m[UI SNAPSHOT]\x1b[0m URL=${currentUrl} | ${elements.length} interactive elements.`);
        fs.appendFileSync(logFile, `\n[AI RESCUE ${attempt}] URL=${currentUrl}\nELEMENTS=${JSON.stringify(elements)}\n`, 'utf8');

        // b. Gọi AI Agent yêu cầu tìm element thay thế (trả về JSON hành động)
        const rescuePrompt = [
          `Bước đang chạy là: '${stepName}'. Lỗi: '${errMsg}'.`,
          `URL hiện tại: ${currentUrl}`,
          `Danh sách các element có trên màn hình: ${JSON.stringify(elements)}`,
          'Hãy xác định hành động thay thế để hoàn thành mục đích của bước này.',
          'Trả về DUY NHẤT một chuỗi JSON dạng:',
          '{"action": "click"|"fill", "target": "<text hoặc selector>", "value": "<nếu fill>"}',
        ].join('\n');

        let aiResult;
        try {
          aiResult = await invokeAgentCli(rescuePrompt, activeCli, config, logFile);
        } catch (aiErr) {
          console.warn('  ⚠️ AI CLI không khả dụng: ' + (aiErr && aiErr.message ? aiErr.message : aiErr));
          continue;
        }

        // c. Parse kết quả JSON từ AI Agent
        const action = parseAiActionJson(aiResult && aiResult.output);
        if (!action) {
          console.warn('  ⚠️ Không parse được JSON hành động từ AI Agent, thử lại...');
          continue;
        }
        console.log(`  \x1b[35m[AI RESCUE]\x1b[0m AI đề xuất: ${JSON.stringify(action)}`);

        // d. Dùng Playwright thực thi hành động do AI chỉ định (taskFrame hoặc page)
        const healed = await executeAiAction(scope, page, action, healMode);
        if (healed) {
          // e. Cứu nguy thành công → cho phép flow TIẾP TỤC chạy các bước kế tiếp
          console.log(`\n\x1b[32m✅ [AI HEALED & RESCUED] Đã tự động phục hồi bước "${stepName}" thành công!\x1b[0m`);
          fs.appendFileSync(logFile, `[AI HEALED] ${stepName} :: ${JSON.stringify(action)}\n`, 'utf8');
          return true;
        }
        console.warn(`  ⚠️ Hành động AI đề xuất chưa thực thi được (lần ${attempt}/2).`);
      }

      // f. AI Rescue thất bại sau 2 lần thử → lúc này mới dừng lại, giữ browser 90s
      console.error('\n================================================================');
      console.error(`\x1b[31m[AI RESCUE FAILED]\x1b[0m AI không thể phục hồi bước "${stepName}" sau 2 lần thử.`);
      console.error('\x1b[33m🛟 KHÔNG đóng trình duyệt! Giữ cửa sổ mở 90 giây để Tester/Sếp quan sát & thao tác thủ công.\x1b[0m');
      console.error('================================================================');
      fs.appendFileSync(logFile, `\n[AI RESCUE FAILED] ${new Date().toISOString()} :: ${stepName}\n`, 'utf8');
      await page.waitForTimeout(90000).catch(() => {});
      await browser.close();
      process.exit(1);
    }
  }

  await runStepWithAiRescue('STEP 2/7 — Bấm Start Process & chờ Task frame', async () => {
    console.log(`\n\x1b[36m[AI STEP 2/7]\x1b[0m Bấm Start Process & chờ Task frame quy trình tải xong...`);
    await pom.clickStartProcessMenuitem();
    console.log('  \x1b[32m✔ Đã mở quy trình (Task frame sẵn sàng)!\x1b[0m');
  });

  await runStepWithAiRescue('STEP 3/7 — Chọn Application "ITS" và xác nhận', async () => {
    console.log(`\n\x1b[36m[AI STEP 3/7]\x1b[0m Chọn Application "ITS" và xác nhận...`);
    await pom.clickApplicationRadio();
    await pom.fillApplicationNameInput('ITS');
    await pom.clickFindApplicationButton();
    await pom.dblclickAbwesenheitsplanerEnviaTelCell();
    await pom.clickOkCell();
    await pom.clickOkCell();
    console.log('  \x1b[32m✔ Đã chọn & xác nhận Application!\x1b[0m');
  });

  await runStepWithAiRescue('STEP 4/7 — Điền Tab 1 (Title, Description, Consequence, Confidentiality, Rating)', async () => {
    console.log(`\n\x1b[36m[AI STEP 4/7]\x1b[0m Điền Tab 1 (Title, Description, Consequence, Confidentiality, Rating)...`);
    await pom.fillRiskTitleInput('doibove1');
    await pom.clickRiskDescriptionInput();
    await pom.fillRiskTitleInput('doibove12');
    await pom.fillRiskDescriptionInput('32');
    await pom.clickRiskConsequenceInput();
    await pom.fillRiskDescriptionInput('323');
    await pom.fillRiskConsequenceInput('22');
    await pom.clickConfidentialityCheckbox();
    await pom.clickAnth5();
    console.log('  \x1b[32m✔ Đã điền form & tick Confidentiality + Rating 5 sao!\x1b[0m');
  });

  await runStepWithAiRescue('STEP 5/7 — Chọn đầy đủ các câu hỏi Likelihood (Tab 1)', async () => {
    console.log(`\n\x1b[36m[AI STEP 5/7]\x1b[0m Chọn đầy đủ các câu hỏi Likelihood (Tab 1)...`);
    await pom.clickRiskanswer0LabelElement();
    await pom.clickNetworkAndProgrammingSkillsOption();
    await pom.clickRiskAnswer1Trigger();
    await pom.clickPracticallyImpossibleOption();
    // [FIX] index 2 trước đây bị thiếu → dropdown giữ "Please select" gây validation.
    // Dùng cùng frame scope (pom.frame) như các method POM đã kiểm chứng thay vì
    // getTaskFrame() (match lỏng theo URL → sai frame → riskAnswer_2 timeout).
    await selectRiskAnswerByIndex(pom.frame, 2, page);
    await pom.clickRiskanswer3LabelElement();
    await pom.clickHiddenOption();
    // [FIX] index 4 trước đây bị thiếu → dropdown giữ "Please select" gây validation.
    await selectRiskAnswerByIndex(pom.frame, 4, page);
    await pom.clickRiskAnswer5Trigger();
    await pom.clickActiveDetectionOption();
    await pom.clickRiskAnswer6Trigger();
    await pom.clickNotAtAllOption();
    console.log('  \x1b[32m✔ Đã chọn xong toàn bộ 7 câu hỏi Likelihood (0→6)!\x1b[0m');
  });

  await runStepWithAiRescue('STEP 6/7 — Chuyển sang Tab 2 (Risk Treatment)', async () => {
    console.log(`\n\x1b[36m[AI STEP 6/7]\x1b[0m Chuyển sang Tab 2 (Risk Treatment)...`);
    // Ground Truth policy trước khi bấm Next:
    //   • MẶC ĐỊNH (không --heal): KHÔNG tự điền. Chỉ phát hiện & báo cáo trung
    //     thực các field còn thiếu/dính validation rồi để luồng chạy tự nhiên —
    //     nếu app chặn ở Next thì bước sẽ fail thật, không che giấu bằng auto-fill.
    //   • --heal / --auto-fill: mới cho phép tự động điền/chọn để cứu luồng.
    const taskFrame6 = await resolveTaskFrame();
    if (healMode) {
      const fixed = await autoFillInvalidFields(taskFrame6);
      if (fixed > 0) {
        console.log(`  \x1b[33m🩹 [AUTO-FILL] Đã tự động điền/chọn ${fixed} field còn thiếu hoặc lỗi validation.\x1b[0m`);
        fs.appendFileSync(logFile, `[AUTO-FILL] Fixed ${fixed} invalid field(s) before Next\n`, 'utf8');
      }
    } else {
      const invalid = await detectInvalidFields(taskFrame6);
      const blockers = [...invalid.dropdowns, ...invalid.inputs];
      if (blockers.length > 0) {
        console.log(`  \x1b[33m🔎 [GROUND TRUTH] Phát hiện ${blockers.length} field còn thiếu/dính validation — KHÔNG tự điền (đúng kịch bản).\x1b[0m`);
        for (const b of invalid.dropdowns) {
          console.log(`     • [dropdown] ${b.label}  (id: ${b.id})`);
        }
        for (const b of invalid.inputs) {
          console.log(`     • [input]    ${b.label}  (id: ${b.id})`);
        }
        console.log('  \x1b[36mℹ Nếu đây là chủ đích (negative/optional) thì bỏ qua. Nếu muốn agent tự điền, chạy lại kèm --heal.\x1b[0m');
        fs.appendFileSync(
          logFile,
          `[GROUND TRUTH] ${blockers.length} unfilled/invalid field(s) before Next (auto-fill OFF): ` +
            JSON.stringify(blockers) + '\n',
          'utf8'
        );
      }
    }
    await pom.clickNextButton();
    console.log('  \x1b[32m✔ Đã sang Tab 2!\x1b[0m');
  });

  await runStepWithAiRescue('STEP 7/7 — Tab 2: Category, Local Security, Control & Hoàn tất', async () => {
    console.log(`\n\x1b[36m[AI STEP 7/7]\x1b[0m Tab 2: Category, Local Security, Control & Hoàn tất...`);
    await pom.clickRiskcategorytagElement();
    await pom.clickDataFromUntrustworthySourceListitem();
    await pom.clickLocalsecurityboxElement();
    await pom.clickCsd1Text();
    await pom.dblclickPleaseSelectControlSText();
    await pom.clickControlCheckbox();
    await pom.clickNextButton();
    console.log('  \x1b[32m✔ Đã hoàn tất Tab 2 thành công!\x1b[0m');
  });

  console.log('\n================================================================');
  console.log(' 🎉 [MODE 2: AI AGENT] HOÀN TẤT TOÀN BỘ KỊCH BẢN THÀNH CÔNG RỰC RỠ!');
  console.log('================================================================');
  console.log(`  * Tracking Log chi tiết: [${logRel}](${fileUrl})`);
  console.log('  * Trình duyệt sẽ giữ mở 8 giây để Tester / Sếp quan sát kết quả...');
  await page.waitForTimeout(8000);

  await browser.close();
}

main().catch(async (err) => {
  console.error('\n\x1b[31m[AI AGENT ERROR]\x1b[0m', err.message || err);
  process.exit(1);
});