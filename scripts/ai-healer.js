/**
 * 🤖 E.ON AI Healer — Automated Self-Healing for Playwright Test Suite
 *
 * Tự động chẩn đoán lỗi thất bại của testcase (Timeout, broken locator, dynamic classes PrimeFaces),
 * kích hoạt AI CLI Agent (GitHub Copilot CLI / Claude CLI) để sửa trực tiếp file POM,
 * và tự động chạy lại test để đảm bảo kịch bản pass 100%.
 *
 * Nâng cấp (Giai đoạn 3 & 4 — AGENT_RECOVERY_ARCHITECTURE_PLAN):
 *   - Đọc ĐẦY ĐỦ `last-failure-context.json` (kèm tracePath / screenshotPath / selectorTried /
 *     frameUrl / stepName) và nạp vào prompt để Agent có ngữ cảnh giàu.
 *   - GUARDRAIL cú pháp: chạy `tsc --noEmit` TRƯỚC & SAU mỗi lần vá; nếu Agent làm hỏng
 *     cú pháp POM/Spec thì REVERT về bản backup, không để lan lỗi biên dịch.
 *   - FEEDBACK LOOP có giới hạn vòng lặp (MAX_HEAL_ROUNDS): mỗi vòng đưa kết quả retest
 *     của vòng trước vào prompt vòng sau để Agent hội tụ.
 *   - Gọi CLI qua binary trực tiếp (cli-runner) — ổn định trên Windows, có timeout mềm.
 *
 * Cách dùng:
 *   npm run heal <KEY>
 *   node scripts/ai-healer.js CREATE_RISK_REQUEST
 *   node scripts/ai-healer.js SEC-11359 --no-retest
 *   node scripts/ai-healer.js CREATE_RISK_REQUEST --max-rounds=2 --cli=claude
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { runCli } = require('./lib/cli-runner');

dotenv.config();

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const DEFAULT_MAX_ROUNDS = Number(process.env.MAX_HEAL_ROUNDS) || 3;
const CLI_TIMEOUT_MS = Number(process.env.AI_AGENT_TIMEOUT) || 120000;

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function resolveWindowsBinary(command) {
  if (!IS_WINDOWS) return command;
  const pathExt = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (fs.existsSync(candidate)) return `${command}${ext}`;
    }
  }
  return command;
}

function toPascal(str) {
  return str.toLowerCase().split(/[_-]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function parseKey(arg) {
  if (!arg) return null;
  let value = String(arg).trim();
  value = value.split(/[?#]/)[0].replace(/\/+$/, '');
  const segment = value.split('/').pop().replace(/\\/g, '/').split('/').pop();
  const match = segment.replace(/^TC-/i, '').replace(/\.spec\.ts$/i, '').match(/([A-Za-z0-9_-]+)/);
  return match ? match[1].toUpperCase() : null;
}

function resolveFiles(key) {
  const pascalName = toPascal(key);
  const candidatesPom = [
    path.join(ROOT_DIR, 'tests', 'pages', 'functions', `${pascalName}Page.ts`),
    path.join(ROOT_DIR, 'tests', 'pages', `TC-${key}.ts`),
    path.join(ROOT_DIR, 'tests', 'pages', `${pascalName}Page.ts`),
  ];
  const pomPath = candidatesPom.find(p => fs.existsSync(p)) || candidatesPom[0];

  const candidatesSpec = [
    path.join(ROOT_DIR, 'tests', 'e2e', 'functions', `TC-${key}.spec.ts`),
    path.join(ROOT_DIR, 'tests', 'e2e', `TC-${key}.spec.ts`),
  ];
  const specPath = candidatesSpec.find(p => fs.existsSync(p)) || candidatesSpec[0];

  return { pomPath, specPath };
}

function readFailureDiagnostics() {
  const diagPath = path.join(ROOT_DIR, 'test-results', 'last-failure-context.json');
  if (fs.existsSync(diagPath)) {
    try {
      return JSON.parse(fs.readFileSync(diagPath, 'utf8'));
    } catch (_) {}
  }
  return null;
}

/** Chạy `tsc --noEmit` như guardrail cú pháp. Trả về { ok, output }. */
function runTsc() {
  const npxBin = resolveWindowsBinary('npx');
  const proc = spawnSync(npxBin, ['tsc', '--noEmit'], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    shell: true,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = (proc.stdout || '') + '\n' + (proc.stderr || '');
  const ok = !proc.error && proc.status === 0;
  return { ok, output };
}

/** Đọc nội dung file an toàn (trả '' nếu không tồn tại). */
function readFileSafe(p) {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  } catch (_) {
    return '';
  }
}

/** Mô tả ngắn gọn artifact (trace/screenshot) để nạp vào prompt. */
function describeArtifacts(fc) {
  const lines = [];
  if (fc.tracePath && fs.existsSync(fc.tracePath)) {
    lines.push(`Playwright trace: ${fc.tracePath} (open with: npx playwright show-trace "${fc.tracePath}")`);
  }
  if (fc.screenshotPath && fs.existsSync(fc.screenshotPath)) {
    lines.push(`Failure screenshot: ${fc.screenshotPath}`);
  }
  if (fc.testResultsDir) {
    lines.push(`Artifacts dir: ${fc.testResultsDir}`);
  }
  return lines.length ? lines.join('\n') : '(no trace/screenshot artifact found)';
}

/** Xây dựng prompt cho Agent, có kèm feedback từ vòng heal trước (nếu có). */
function buildPrompt(key, pomPath, specPath, fc, round, feedback) {
  return [
    `You are an expert Playwright automation engineer fixing a failing test for Axon Ivy / PrimeFaces module "${key}".`,
    `This is heal round ${round}.`,
    '',
    '=== ERROR OCCURRED ===',
    `Step Name: ${fc.stepName || fc.step || 'unknown'}`,
    `Action: ${fc.action || 'unknown'}`,
    `Role: ${fc.role || ''}`,
    `Target name: ${fc.name || ''}`,
    `Selector tried: ${fc.selectorTried || '(unknown)'}`,
    `Frame URL: ${fc.frameUrl || '(unknown)'}`,
    `Details: ${fc.error || 'Element not found or timed out during execution'}`,
    '',
    '=== ARTIFACTS (inspect if helpful) ===',
    describeArtifacts(fc),
    '',
    '=== TARGET FILES ===',
    `POM:  ${pomPath}`,
    `Spec: ${specPath}`,
    '',
    '=== PRIMEFACES TECHNICAL RULES ===',
    '1. Radio buttons & Checkboxes: PrimeFaces hides native <input> behind "ui-helper-hidden-accessible". ALWAYS interact via visible label: locator(\'label:has-text("...")\') or .ui-radiobutton-box / .ui-chkbox-box.',
    '2. Dropdowns (p:selectOneMenu): Click .ui-selectonemenu-trigger or .ui-selectonemenu-label, then pick the item inside the visible .ui-selectonemenu-panel by text.',
    '3. Multiselect (p:selectCheckboxMenu): open via .ui-selectcheckboxmenu-trigger, tick items inside .ui-selectcheckboxmenu-panel, then close the panel.',
    '4. Dynamic IDs: PrimeFaces auto-generates dynamic prefix IDs (e.g. "form:j_idt123:field"). Use attribute ends-with [id$=":field"] or stable aria/role/text selectors — NEVER hard-code j_idt IDs.',
    '5. Wait states: Respect ajaxStatus spinner (.ajax-status-position). Prefer the resilient helpers in tests/support/primefaces.ts (waitAjaxIdle, selectOneMenu, selectCheckboxMenu, radio, checkbox) when appropriate.',
    '6. DO NOT break method names, parameters, class names, or the public interface of the POM. Only fix locators and action mechanics so existing specs keep compiling.',
    '',
    feedback ? '=== PREVIOUS HEAL ROUND RESULT (fix what still fails) ===' : '',
    feedback || '',
    '',
    '=== TASK ===',
    `1. Read ${pomPath} (and ${specPath} if needed) carefully.`,
    `2. Identify the broken locator/method corresponding to the failing step above.`,
    `3. Modify ${pomPath} directly to make the locator resilient (follow the rules).`,
    '4. Keep the file valid TypeScript. Do NOT change public method signatures.',
    '5. Save the updated file.',
  ].filter(l => l !== null && l !== undefined).join('\n');
}

/** Gọi Agent (Copilot trước, fallback Claude khi quota/không khả dụng). */
async function invokeAgent(promptText, preferredCli, logStream) {
  const order = preferredCli === 'claude' ? ['claude', 'copilot'] : ['copilot', 'claude'];
  let combined = '';
  let success = false;
  let usedCli = null;

  for (let i = 0; i < order.length; i++) {
    const cli = order[i];
    console.log(`  -> Đang gọi ${cli.toUpperCase()} CLI (binary trực tiếp)...`);
    let binary;
    let args;
    let input;
    if (cli === 'copilot') {
      binary = 'copilot';
      args = ['-p', promptText, '--allow-all'];
      input = undefined;
    } else {
      binary = 'claude';
      args = ['--print', '--dangerously-skip-permissions'];
      input = promptText;
    }

    logStream.write(`\n=== ${cli.toUpperCase()} STREAM (${new Date().toISOString()}) ===\n`);
    const res = await runCli(binary, args, {
      input,
      cwd: ROOT_DIR,
      env: process.env,
      timeoutMs: CLI_TIMEOUT_MS,
      logStream,
    });

    const out = (res.stdout || '') + '\n' + (res.stderr || '');
    combined += `\n=== ${cli.toUpperCase()} OUTPUT ===\n` + out;

    const notFound = !!res.error && /không tìm thấy binary/i.test(res.error.message || '');
    const quota = /exceeded your monthly quota|rate limit/i.test(out);

    if (notFound) {
      console.warn(`  ⚠️ Không tìm thấy binary "${binary}" — thử CLI kế tiếp...`);
      continue;
    }
    if (res.timedOut) {
      console.warn(`  ⚠️ ${cli.toUpperCase()} CLI timeout sau ${CLI_TIMEOUT_MS}ms — đã kill tiến trình.`);
    }
    if (quota) {
      console.warn(`  ⚠️ ${cli.toUpperCase()} CLI hết quota -> thử CLI kế tiếp...`);
      continue;
    }
    success = !res.error && res.status === 0;
    usedCli = cli;
    if (success) break;
    console.warn(`  ⚠️ ${cli.toUpperCase()} CLI kết thúc bất thường (status=${res.status}) -> thử CLI kế tiếp...`);
  }

  return { success, output: combined, usedCli };
}

/** Chạy lại spec để xác nhận. Trả về { passed, output }. */
function retest(specPath, logStream) {
  const specRel = path.relative(ROOT_DIR, specPath).replace(/\\/g, '/');
  const npxBin = resolveWindowsBinary('npx');
  const testArgs = ['playwright', 'test', specRel, '--project=chromium', '--headed', '--reporter=list'];
  const proc = spawnSync(npxBin, testArgs, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, INTERACTIVE_SSO: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = (proc.stdout || '') + '\n' + (proc.stderr || '');
  if (logStream) logStream.write('\n=== RETEST OUTPUT ===\n' + output);
  process.stdout.write(output);
  const passed = !proc.error && proc.status === 0;
  return { passed, output };
}

async function healTest(key, options = {}) {
  console.log('\n======================================================');
  console.log(` 🛡️ AI HEALER — Self-Healing Pipeline for: ${key}`);
  console.log('======================================================');

  const { pomPath, specPath } = resolveFiles(key);
  console.log(`  * Target POM:  ${path.relative(ROOT_DIR, pomPath)}`);
  console.log(`  * Target Spec: ${path.relative(ROOT_DIR, specPath)}`);

  if (!fs.existsSync(pomPath)) {
    console.error(`\n\x1b[31m[ERROR] POM file does not exist: ${pomPath}\x1b[0m`);
    console.error('  -> Please run: npm run sync-specs ' + key);
    return false;
  }

  const failureContext = options.failureContext || readFailureDiagnostics() || {
    step: 'UI interaction timeout / locator mismatch',
    stepName: 'UI interaction timeout / locator mismatch',
    action: 'click',
    error: 'Element not found or timed out during execution',
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOGS_DIR, `ai-heal-${key}-${timestamp}.log`);
  const logRel = path.relative(ROOT_DIR, logFile).replace(/\\/g, '/');
  const fileUrl = `file:///${logFile.replace(/\\/g, '/')}`;
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  console.log(`  * Tracking Log: [${logRel}](${fileUrl})`);

  // 🛡️ GUARDRAIL trước: baseline tsc để phân biệt lỗi có sẵn vs lỗi do heal gây ra.
  console.log('\n[AI-HEAL] Guardrail: chạy `tsc --noEmit` baseline TRƯỚC khi vá...');
  const tscBefore = runTsc();
  logStream.write('\n=== TSC BEFORE ===\n' + tscBefore.output);
  console.log(`  * tsc baseline: ${tscBefore.ok ? 'PASS (0 lỗi)' : 'đã có lỗi từ trước'}`);

  const maxRounds = Math.max(1, options.maxRounds || DEFAULT_MAX_ROUNDS);
  const preferredCli = options.cli || 'copilot';
  let feedback = '';
  let finalSuccess = false;

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`\n\x1b[36m======== HEAL ROUND ${round}/${maxRounds} ========\x1b[0m`);
    logStream.write(`\n\n######## HEAL ROUND ${round}/${maxRounds} ########\n`);

    // Snapshot POM & Spec để revert nếu Agent làm hỏng cú pháp.
    const pomBackup = readFileSafe(pomPath);
    const specBackup = readFileSafe(specPath);

    const prompt = buildPrompt(key, pomPath, specPath, failureContext, round, feedback);
    console.log('[AI-HEAL] Gửi ngữ cảnh lỗi (kèm trace/screenshot nếu có) cho Agent...');
    const agent = await invokeAgent(prompt, preferredCli, logStream);

    if (!agent.success) {
      console.warn('\x1b[33m[AI-HEAL] Agent không hoàn tất bình thường ở vòng này.\x1b[0m');
    }

    // 🛡️ GUARDRAIL sau: nếu Agent làm hỏng cú pháp -> REVERT.
    console.log('[AI-HEAL] Guardrail: chạy `tsc --noEmit` SAU khi vá...');
    const tscAfter = runTsc();
    logStream.write('\n=== TSC AFTER (round ' + round + ') ===\n' + tscAfter.output);

    const introducedTsErrors = !tscAfter.ok && tscBefore.ok;
    if (introducedTsErrors) {
      console.error('\x1b[31m[AI-HEAL] ⚠️ Bản vá gây LỖI biên dịch TypeScript — REVERT POM/Spec về bản backup.\x1b[0m');
      logStream.write('\n=== REVERTED (tsc broke) ===\n');
      try {
        if (pomBackup) fs.writeFileSync(pomPath, pomBackup, 'utf8');
        if (specBackup && fs.existsSync(specPath)) fs.writeFileSync(specPath, specBackup, 'utf8');
      } catch (_) {}
      feedback = [
        `Round ${round} produced TypeScript compile errors and was reverted. Do NOT break types or public signatures.`,
        'tsc errors:',
        tscAfter.output.split('\n').filter(l => /error TS/i.test(l)).slice(0, 20).join('\n'),
      ].join('\n');
      continue;
    }
    console.log(`  * tsc sau vá: ${tscAfter.ok ? 'PASS (0 lỗi)' : 'còn lỗi (đã tồn tại từ baseline)'}`);

    if (options.noRetest) {
      console.log('\n[AI-HEAL] Retest skipped (--no-retest). Kết thúc sau vòng vá đầu tiên.');
      finalSuccess = agent.success && tscAfter.ok;
      break;
    }

    console.log('\n[AI-HEAL] Chạy lại test để xác nhận POM đã được sửa...');
    const rt = retest(specPath, logStream);
    if (rt.passed) {
      console.log('\n\x1b[32m🎉 [AI-HEAL SUCCESS] Test đã PASS sau khi AI sửa POM (round ' + round + ')!\x1b[0m\n');
      finalSuccess = true;
      break;
    }

    console.warn(`\x1b[33m[AI-HEAL] Vòng ${round} vẫn fail. ${round < maxRounds ? 'Đưa kết quả retest vào vòng sau...' : 'Đã đạt giới hạn vòng lặp.'}\x1b[0m`);
    // Cập nhật ngữ cảnh lỗi mới nhất (nếu smart-action ghi lại) + feedback retest.
    const refreshed = readFailureDiagnostics();
    if (refreshed) Object.assign(failureContext, refreshed);
    feedback = [
      `Round ${round} was applied but the test STILL FAILS on retest. Analyze the retest output and fix the remaining issue.`,
      'Retest output (tail):',
      rt.output.split('\n').slice(-40).join('\n'),
    ].join('\n');
  }

  try { logStream.end(); } catch (_) {}
  console.log(`[AI-HEAL] Chi tiết tiến trình: [${logRel}](${fileUrl})`);

  if (!finalSuccess) {
    console.log('\n\x1b[31m⚠️ [AI-HEAL FAILED] Test vẫn chưa pass sau ' + maxRounds + ' vòng heal.\x1b[0m');
    console.log(`  [${logRel}](${fileUrl})\n`);
  }
  return finalSuccess;
}

// CLI entry point
if (require.main === module) {
  const argv = process.argv.slice(2);
  const positional = argv.find(a => !a.startsWith('-'));
  const key = parseKey(positional);

  if (!key) {
    console.log('\n\x1b[33mUsage: npm run heal <KEY> [--no-retest] [--cli=claude|copilot] [--max-rounds=N]\x1b[0m');
    console.log('   Example: npm run heal CREATE_RISK_REQUEST');
    console.log('            npm run heal SEC-11359 --no-retest --max-rounds=2\n');
    process.exit(1);
  }

  const noRetest = argv.includes('--no-retest');
  const cliFlag = argv.find(a => a.startsWith('--cli='));
  const cli = cliFlag ? cliFlag.split('=')[1] : undefined;
  const roundsFlag = argv.find(a => a.startsWith('--max-rounds='));
  const maxRounds = roundsFlag ? Number(roundsFlag.split('=')[1]) : undefined;

  healTest(key, { noRetest, cli, maxRounds }).then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('[AI-HEAL CRITICAL ERROR]', err);
    process.exit(1);
  });
}

module.exports = { healTest };
