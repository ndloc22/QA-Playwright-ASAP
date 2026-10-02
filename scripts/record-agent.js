/**
 * 🤖🎬 Record Agent — Luồng 2: Prompt-driven Auto-Record (record:agent)
 *
 * Tester đưa 1 prompt → AI Agent điều khiển trình duyệt (Perceive → Plan → Act) →
 * Instrumented Executor intercept MỌI action THÀNH CÔNG → ghi băng recording.ts chuẩn
 * codegen → tự chạy sync-specs ra POM + Spec. Lần sau hồi quy chỉ cần
 * `npm run test:function <KEY>` (0 token).
 *
 * Khác với codegen "nghe lén": orchestrator CHÍNH là người thực thi action nên biết
 * chắc locator nào vừa chạy thành công → ghi đúng selector sạch (ưu tiên getByRole/
 * getByLabel/[id], strip ui-state-*), KHÔNG dính rác hover/active.
 *
 * Cách dùng:
 *   npm run record:agent <KEY> -- --prompt-file docs/tester-prompts/create-risk-request.prompt.md
 *   npm run record:agent <KEY> -- --prompt "Mở Start Process, điền Risk Title='x' rồi Next"
 *   npm run record:agent <KEY> -- --cli claude --slowmo 400 --max-steps 40
 *   npm run record:agent <KEY> -- --no-sync        # chỉ ghi recording, không sinh POM/Spec
 *   npm run record:agent <KEY> -- --run            # sau khi sync, chạy luôn test:function để xác nhận
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { chromium } = require('@playwright/test');

const { runCli } = require('./lib/cli-runner');
const {
  collectInteractiveElements,
  parseAiActionJson,
  isSsoUrl,
  resolveBinary,
  maximizeWindow,
  ssoHandoff,
} = require('./lib/agent-dom');
const { RecordingTape } = require('./lib/recording-tape');
const actionExecutor = require('./lib/action-executor');
const {
  IFRAME_SCROLL_FIX_SCRIPT,
  PF_DROPDOWN_BRIDGE_SCRIPT,
  DOM_ANNOTATOR_SCRIPT,
} = require('./lib/record-init-scripts');

dotenv.config();

const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, 'config', 'agent.json');
const AUTH_FILE = path.join(ROOT_DIR, '.auth', 'user.json');
const LOGS_DIR = path.join(ROOT_DIR, 'logs', 'agent-runs');
const RECORDINGS_FUNCTIONS_DIR = path.join(ROOT_DIR, 'tests', 'recordings', 'functions');
const PROMPTS_DIR = path.join(ROOT_DIR, 'docs', 'tester-prompts');

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// ── CLI parsing ──────────────────────────────────────────────────────────────
function parseKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  if (!value) return null;
  value = value.split(/[\\/]/).pop()
    .replace(/\.recording\.ts$/i, '')
    .replace(/\.spec\.ts$/i, '')
    .replace(/\.md$/i, '');
  value = value.replace(/^TC-/i, '');
  const match = value.match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const positional = argv.find((a) => !a.startsWith('-'));
  const key = parseKey(positional);

  const flagVal = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };

  const cli = (flagVal('--cli') || '').toLowerCase() || null;
  const promptFile = flagVal('--prompt-file');
  const promptText = flagVal('--prompt');
  const slowmo = parseInt(flagVal('--slowmo') || '400', 10);
  const maxSteps = parseInt(flagVal('--max-steps') || '60', 10);
  const noSync = argv.includes('--no-sync');
  const run = argv.includes('--run');

  return { key, cli, promptFile, promptText, slowmo, maxSteps, noSync, run };
}

function loadConfig() {
  let cfg = {
    defaultCli: process.env.AI_AGENT_CLI || 'copilot',
    autoFallback: process.env.AI_AGENT_FALLBACK !== 'false',
    timeoutMs: Number(process.env.AI_AGENT_TIMEOUT) || 60000,
    copilot: { model: process.env.COPILOT_MODEL || 'claude-opus-4.8', flags: ['--allow-all'] },
    claude: { flags: ['--print', '--dangerously-skip-permissions'] },
  };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch (_) {}
  }
  return cfg;
}

// ── Prompt loading ───────────────────────────────────────────────────────────
function loadPrompt(key, promptFile, promptText) {
  if (promptFile) {
    const p = path.isAbsolute(promptFile) ? promptFile : path.join(ROOT_DIR, promptFile);
    if (fs.existsSync(p)) return { text: fs.readFileSync(p, 'utf8'), source: p };
  }
  if (promptText) return { text: promptText, source: '(--prompt inline)' };

  // Fallback: docs/tester-prompts/<key>.prompt.md (case-insensitive) hoặc testcase ground-truth.
  const candidates = [
    path.join(PROMPTS_DIR, `${key}.prompt.md`),
    path.join(PROMPTS_DIR, `${key.toLowerCase()}.prompt.md`),
    path.join(PROMPTS_DIR, `${key.toLowerCase().replace(/_/g, '-')}.prompt.md`),
    path.join(ROOT_DIR, 'tests', 'testcases', 'functions', `TC-${key}.md`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return { text: fs.readFileSync(c, 'utf8'), source: c };
  }
  return { text: null, source: null };
}

// ── Entry URL cleansing (bỏ đoạn ephemeral /faces/instances...) ──────────────
function cleanseEntryUrl(url) {
  if (!url) return null;
  const m = String(url).match(/^(https?:\/\/[^'"\s]*?)\/faces\/(?:instances|dialog)\b/i);
  return m ? m[1] : String(url);
}

// ── AI CLI invocation (tái dùng cli-runner, có fallback + timeout mềm) ────────
async function invokeAgentCli(promptText, activeCli, config, logFile) {
  async function runOneCli(cliName) {
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    logStream.write(`\n=== ${cliName.toUpperCase()} STREAM (${new Date().toISOString()}) ===\n`);
    let binary;
    let args;
    if (cliName === 'copilot') {
      binary = 'copilot';
      args = ['--model', config.copilot?.model || 'claude-opus-4.8', '--allow-all'];
    } else {
      binary = 'claude';
      args = ['--print', '--dangerously-skip-permissions'];
    }
    const res = await runCli(binary, args, {
      input: promptText,
      cwd: ROOT_DIR,
      env: process.env,
      timeoutMs: config.timeoutMs,
      logStream,
    });
    try { logStream.end(); } catch (_) {}
    const resOut = (res.stdout || '') + '\n' + (res.stderr || '');
    const isQuota = /exceeded your monthly quota|rate limit/i.test(resOut);
    const isOk = !res.error && res.status === 0 && !isQuota;
    return { isOk, resOut };
  }

  let output = '';
  const first = await runOneCli(activeCli);
  output += `=== ${activeCli.toUpperCase()} OUTPUT ===\n` + first.resOut;
  let success = first.isOk;
  let usedCli = activeCli;

  if (!success && config.autoFallback) {
    const fb = activeCli === 'copilot' ? 'claude' : 'copilot';
    console.warn(`  \x1b[33m⚠️ ${activeCli.toUpperCase()} không khả dụng/hết quota → chuyển sang ${fb.toUpperCase()}...\x1b[0m`);
    const second = await runOneCli(fb);
    output += `\n=== FALLBACK ${fb.toUpperCase()} OUTPUT ===\n` + second.resOut;
    success = second.isOk;
    usedCli = fb;
  }

  fs.appendFileSync(logFile, output + '\n\n', 'utf8');
  return { success, output, usedCli };
}

// ── Task frame resolver (cùng iframe mà POM/recording dùng) ───────────────────
async function resolveTaskFrame(page) {
  try {
    const handle = await page.waitForSelector(
      'iframe[src*="de.eon.itsp.riskassessment"], iframe[src*="riskassessment"], iframe[title="Task frame"]',
      { state: 'attached', timeout: 4000 }
    );
    const f = handle ? await handle.contentFrame() : null;
    if (f) return f;
  } catch (_) {}
  for (const fr of page.frames()) {
    if (/riskassessment|task|process/i.test(fr.url())) return fr;
  }
  return page;
}

function buildStepPrompt(goalPrompt, history, snapshot, currentUrl) {
  return [
    '# Bối cảnh',
    'Bạn là AI Agent điều khiển trình duyệt để hoàn thành mục tiêu kiểm thử sau trên app Axon Ivy Portal (PrimeFaces).',
    '',
    '## Mục tiêu tổng (prompt gốc của Tester):',
    goalPrompt.trim(),
    '',
    `## URL hiện tại: ${currentUrl}`,
    '',
    '## Các bước đã THỰC THI THÀNH CÔNG (đừng lặp lại):',
    history.length ? history.map((h, i) => `${i + 1}. ${JSON.stringify(h)}`).join('\n') : '(chưa có)',
    '',
    '## Các element tương tác được đang hiển thị trên màn hình:',
    JSON.stringify(snapshot),
    '',
    '# Yêu cầu',
    'Hãy quyết định HÀNH ĐỘNG KẾ TIẾP DUY NHẤT để tiến gần hơn tới mục tiêu.',
    'Chỉ trả về DUY NHẤT một chuỗi JSON (không giải thích), theo đúng schema:',
    '{"action":"click|fill|selectOption|press|check|done","target":"<text nhãn hoặc selector>","value":"<chỉ khi fill/selectOption/press>"}',
    '- Ưu tiên "target" là TÊN/NHÃN người đọc được (vd "Risk Title", "Next") thay vì selector thô.',
    '- Khi đã hoàn thành toàn bộ mục tiêu, trả {"action":"done"}.',
  ].join('\n');
}

async function main() {
  const { key, cli, promptFile, promptText, slowmo, maxSteps, noSync, run } = parseArgs();

  if (!key) {
    console.log('\n\x1b[33mUsage: npm run record:agent <KEY> -- [--prompt-file <path> | --prompt "<text>"] [--cli copilot|claude] [--slowmo 400] [--max-steps 60] [--no-sync] [--run]\x1b[0m');
    console.log('   Ví dụ: npm run record:agent CREATE_RISK_REQUEST -- --prompt-file docs/tester-prompts/create-risk-request.prompt.md --run\n');
    process.exit(1);
  }

  const config = loadConfig();
  const activeCli = cli || config.defaultCli || 'copilot';
  const prompt = loadPrompt(key, promptFile, promptText);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOGS_DIR, `record-agent-${key}-${timestamp}.log`);

  console.log('================================================================');
  console.log(` 🤖🎬 [RECORD AGENT] PROMPT-DRIVEN AUTO-RECORD: ${key}`);
  console.log('================================================================');
  console.log(`  * Preferred CLI: ${activeCli.toUpperCase()}`);
  console.log(`  * Prompt source: ${prompt.source || '(none)'}`);
  console.log(`  * Max steps:     ${maxSteps}`);
  console.log(`  * SlowMo:        ${slowmo}ms`);
  console.log(`  * Auto sync:     ${noSync ? 'OFF (--no-sync)' : 'ON → sync-specs sau khi ghi'}`);
  console.log(`  * Verify run:    ${run ? 'ON (--run → test:function)' : 'OFF'}`);
  console.log(`  * Tracking Log:  ${path.relative(ROOT_DIR, logFile).replace(/\\/g, '/')}`);
  console.log('----------------------------------------------------------------\n');

  if (!prompt.text) {
    console.error('\x1b[31m[ERROR] Không tìm thấy prompt. Cung cấp --prompt-file <path> hoặc --prompt "<text>",');
    console.error(`        hoặc tạo docs/tester-prompts/${key.toLowerCase()}.prompt.md.\x1b[0m`);
    process.exit(1);
  }

  const hasCopilot = !!resolveBinary('copilot');
  const hasClaude = !!resolveBinary('claude');
  if (!hasCopilot && !hasClaude) {
    console.error('\x1b[31m[ERROR] Không tìm thấy GitHub Copilot CLI hoặc Claude CLI trong PATH.\x1b[0m');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: slowmo,
    args: ['--start-maximized', '--window-position=0,0', '--window-size=2560,1440'],
  });

  const viewport = { width: 2560, height: 1440 };
  const contextOpts = { viewport: null, locale: 'vi-VN' };
  if (fs.existsSync(AUTH_FILE)) contextOpts.storageState = AUTH_FILE;

  const context = await browser.newContext(contextOpts);

  // Init-scripts dùng chung với record:ticket (Layer 1 Annotator + Layer 2 Bridge + scroll-fix).
  await context.addInitScript(IFRAME_SCROLL_FIX_SCRIPT);
  await context.addInitScript(PF_DROPDOWN_BRIDGE_SCRIPT);
  await context.addInitScript(DOM_ANNOTATOR_SCRIPT);

  const page = await context.newPage();
  await maximizeWindow(context, page);

  page.on('dialog', async (d) => {
    console.log(`  \x1b[35m[Dialog]\x1b[0m auto-dismiss: "${d.message().slice(0, 80)}"`);
    await d.dismiss().catch(() => {});
  });

  const BASE_URL = (process.env.BASE_URL || 'https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec').replace(/\/+$/, '');

  // Băng ghi: meta byte-tương thích codegen.
  const tape = new RecordingTape({
    deviceScaleFactor: 1,
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
    viewport,
  });

  console.log(`\x1b[36m[STEP]\x1b[0m Mở Portal: ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // SSO hand-off nếu rơi vào trang đăng nhập Microsoft.
  if (isSsoUrl(page.url())) {
    console.log('\x1b[33m[SSO HAND-OFF] Vui lòng đăng nhập & xác thực MFA trên cửa sổ trình duyệt (chờ 120s)...\x1b[0m');
    const loggedIn = await ssoHandoff(page, context, { authFile: AUTH_FILE, timeoutMs: 120000 });
    if (!loggedIn) {
      console.error('\x1b[31m[ERROR] Hết thời gian chờ đăng nhập SSO. Dừng.\x1b[0m');
      await browser.close();
      process.exit(1);
    }
    console.log('\x1b[32m✔ Đăng nhập thành công, đã lưu .auth/user.json.\x1b[0m');
  }

  // Ghi entry URL SẠCH (ưu tiên BASE_URL, bỏ đoạn ephemeral /faces/instances).
  const entryUrl = cleanseEntryUrl(BASE_URL) || BASE_URL;
  tape.goto(entryUrl);

  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // ── LOOP: Perceive → Plan → Act → Record ───────────────────────────────────
  const history = [];
  let done = false;
  let consecutiveFails = 0;

  for (let step = 1; step <= maxSteps && !done; step++) {
    const taskFrame = await resolveTaskFrame(page);
    const scope = taskFrame || page;
    const currentUrl = page.url();

    // a. Perceive — snapshot UI (frame + page).
    const frameEls = scope !== page ? await collectInteractiveElements(scope) : [];
    const pageEls = await collectInteractiveElements(page);
    const snapshot = [...frameEls, ...pageEls].slice(0, 120);
    console.log(`\n\x1b[36m[STEP ${step}/${maxSteps}]\x1b[0m URL=${currentUrl} | ${snapshot.length} elements.`);

    // b. Plan — hỏi AI hành động kế tiếp.
    const stepPrompt = buildStepPrompt(prompt.text, history, snapshot, currentUrl);
    fs.appendFileSync(logFile, `\n[STEP ${step}] URL=${currentUrl}\nSNAPSHOT=${JSON.stringify(snapshot)}\n`, 'utf8');

    let aiResult;
    try {
      aiResult = await invokeAgentCli(stepPrompt, activeCli, config, logFile);
    } catch (e) {
      console.warn('  ⚠️ AI CLI lỗi: ' + (e && e.message ? e.message : e));
      consecutiveFails++;
      if (consecutiveFails >= 3) break;
      continue;
    }

    const action = parseAiActionJson(aiResult && aiResult.output);
    if (!action) {
      console.warn('  ⚠️ Không parse được JSON hành động từ AI, thử lại...');
      consecutiveFails++;
      if (consecutiveFails >= 3) break;
      continue;
    }

    if (String(action.action).toLowerCase() === 'done') {
      console.log('  \x1b[32m✔ AI báo HOÀN TẤT mục tiêu.\x1b[0m');
      done = true;
      break;
    }
    console.log(`  \x1b[35m[AI]\x1b[0m ${JSON.stringify(action)}`);

    // c + d. Act + Record — Instrumented Executor chỉ ghi khi thành công.
    const res = await actionExecutor.perform(scope, page, action, tape, {
      frameSelector: 'iframe[title="Task frame"]',
    });

    if (res.ok) {
      consecutiveFails = 0;
      history.push({ action: action.action, target: action.target, value: action.value });
      console.log(`  \x1b[32m✔ OK\x1b[0m → ghi băng: ${res.usedLocatorExpr}`);
      fs.appendFileSync(logFile, `[RECORDED] ${res.usedLocatorExpr}\n`, 'utf8');
    } else {
      consecutiveFails++;
      console.warn(`  ⚠️ Không thực thi được action (lần liên tiếp ${consecutiveFails}/3): ${res.error && res.error.message}`);
      fs.appendFileSync(logFile, `[FAILED] ${JSON.stringify(action)} :: ${res.error && res.error.message}\n`, 'utf8');
      if (consecutiveFails >= 3) {
        console.warn('  🛑 3 action liên tiếp thất bại — dừng vòng lặp an toàn, giữ phần đã ghi.');
        break;
      }
    }
  }

  if (!done) {
    console.log('\n\x1b[33m[INFO] Vòng lặp kết thúc (đạt max-steps hoặc dừng an toàn). Vẫn lưu phần đã ghi.\x1b[0m');
  }

  // 5. Ghi file recording.ts
  if (!fs.existsSync(RECORDINGS_FUNCTIONS_DIR)) fs.mkdirSync(RECORDINGS_FUNCTIONS_DIR, { recursive: true });
  const recordingPath = path.join(RECORDINGS_FUNCTIONS_DIR, `${key}.recording.ts`);
  fs.writeFileSync(recordingPath, tape.toSource(), 'utf8');
  console.log(`\n\x1b[32m[OK] Recording saved (${tape.count} actions): tests/recordings/functions/${key}.recording.ts\x1b[0m`);

  if (tape.count === 0) {
    console.warn('\x1b[33m[WARN] Recording rỗng (0 action) — bỏ qua auto sync-specs.\x1b[0m');
    await browser.close();
    return;
  }

  // 6. Auto sync-specs → POM + Spec
  if (!noSync) {
    console.log(`\n[AUTO] sync-specs ${key} (--force-pom --force-spec)...`);
    const syncRes = spawnSync(process.execPath, [path.join(__dirname, 'sync-specs.js'), key, '--force-pom', '--force-spec'], {
      stdio: 'inherit',
      cwd: ROOT_DIR,
    });
    if (syncRes.error || syncRes.status !== 0) {
      console.warn(`\x1b[33m[WARN] sync-specs lỗi (status ${syncRes.status}). Chạy tay: npm run sync-specs ${key}\x1b[0m`);
    }
  }

  // 7. (tuỳ chọn) chạy thử để xác nhận GREEN
  if (run && !noSync) {
    console.log(`\n[AUTO] test:function ${key} để xác nhận GREEN...`);
    spawnSync(process.execPath, [path.join(__dirname, 'run-function.js'), key], {
      stdio: 'inherit',
      cwd: ROOT_DIR,
    });
  }

  console.log('\n================================================================');
  console.log(` 🎉 [RECORD AGENT] HOÀN TẤT: ${key}`);
  console.log('================================================================');
  console.log(`  * Recording:   tests/recordings/functions/${key}.recording.ts`);
  if (!noSync) {
    console.log(`  * Page Object: tests/pages/functions/...Page.ts`);
    console.log(`  * Test Spec:   tests/e2e/functions/TC-${key}.spec.ts`);
  }
  console.log(`\n  Hồi quy (0 token): npm run test:function ${key}\n`);

  await page.waitForTimeout(4000);
  await browser.close();
}

main().catch(async (err) => {
  console.error('\n\x1b[31m[RECORD AGENT ERROR]\x1b[0m', err && err.message ? err.message : err);
  process.exit(1);
});
