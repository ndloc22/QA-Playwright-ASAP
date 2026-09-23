/**
 * 🤖 E.ON AI Healer — Automated Self-Healing for Playwright Test Suite
 *
 * Tự động chẩn đoán lỗi thất bại của testcase (Timeout, broken locator, dynamic classes PrimeFaces),
 * kích hoạt AI CLI Agent (GitHub Copilot CLI / Claude CLI) để sửa trực tiếp file POM,
 * và tự động chạy lại test để đảm bảo kịch bản pass 100%.
 *
 * Cách dùng:
 *   npm run heal <KEY>
 *   node scripts/ai-healer.js CREATE_RISK_REQUEST
 *   node scripts/ai-healer.js SEC-11359 --no-retest
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config();

const IS_WINDOWS = process.platform === 'win32';
const ROOT_DIR = path.join(__dirname, '..');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');

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

  // Đọc ngữ cảnh lỗi
  const failureContext = options.failureContext || readFailureDiagnostics() || {
    step: 'UI interaction timeout / locator mismatch',
    action: 'click',
    error: 'Element not found or timed out during execution',
  };

  // Xây dựng log file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOGS_DIR, `ai-heal-${key}-${timestamp}.log`);
  const logRel = path.relative(ROOT_DIR, logFile).replace(/\\/g, '/');
  const fileUrl = `file:///${logFile.replace(/\\/g, '/')}`;

  console.log(`  * Tracking Log: [${logRel}](${fileUrl})`);
  console.log('\n[AI-HEAL] Gửi thông tin lỗi và file POM cho Agent chẩn đoán...');

  const promptText = [
    `You are an expert Playwright automation engineer fixing a failing test for Axon Ivy / PrimeFaces module "${key}".`,
    '',
    '=== ERROR OCCURRED ===',
    `Step Name: ${failureContext.step}`,
    `Action: ${failureContext.action}`,
    `Details: ${failureContext.error}`,
    '',
    '=== TARGET POM FILE ===',
    `Path: ${pomPath}`,
    '',
    '=== PRIMEFACES TECHNICAL RULES ===',
    '1. Radio buttons & Checkboxes: PrimeFaces hides native <input> behind "ui-helper-hidden-accessible". ALWAYS interact via visible label: locator(\'label:has-text("...")\') or .ui-radiobutton-box.',
    '2. Dropdowns: Click .ui-selectonemenu-trigger or .ui-selectonemenu-label.',
    '3. Dynamic IDs: PrimeFaces auto-generates dynamic prefix IDs (e.g. "form:j_idt123:field"). Use attribute ends-with [id$=":field"] or stable aria/role/text selectors.',
    '4. Wait states: Respect ajaxStatus spinner (.ajax-status-position) and ensure elements are scrolled into view before interaction.',
    '5. DO NOT break method names, parameters, or class structure in the POM. Only fix locators and action mechanics.',
    '',
    '=== TASK ===',
    `1. Read ${pomPath} carefully.`,
    `2. Identify the broken locator or method corresponding to "${failureContext.step}".`,
    `3. Modify ${pomPath} directly to fix the locator and make it resilient.`,
    '4. Save the updated file.',
  ].join('\n');

  let agentOutput = '';
  let agentSuccess = false;
  let activeAgent = options.cli || 'copilot';

  // Thử Copilot CLI trước nếu không chỉ định rõ
  if (activeAgent === 'copilot') {
    console.log('  -> Đang gọi GitHub Copilot CLI...');
    const proc = spawnSync('copilot', ['-p', promptText, '--allow-all'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      shell: true,
      env: process.env,
    });
    const cpOut = (proc.stdout || '') + '\n' + (proc.stderr || '');
    agentOutput += cpOut;
    const quotaExceeded = /exceeded your monthly quota/i.test(cpOut);
    agentSuccess = !proc.error && proc.status === 0 && !quotaExceeded;

    if (quotaExceeded || !agentSuccess) {
      console.warn('  ⚠️ GitHub Copilot CLI hết quota hoặc không khả dụng -> Tự động chuyển tiếp sang Claude CLI...');
      activeAgent = 'claude';
    }
  }

  // Fallback sang Claude CLI
  if (activeAgent === 'claude') {
    console.log('  -> Đang gọi Claude CLI (--print --dangerously-skip-permissions)...');
    const proc = spawnSync('claude', ['--print', '--dangerously-skip-permissions'], {
      input: promptText,
      cwd: ROOT_DIR,
      encoding: 'utf8',
      shell: true,
      env: process.env,
    });
    agentOutput += '\n=== CLAUDE CLI OUTPUT ===\n' + (proc.stdout || '') + '\n' + (proc.stderr || '');
    agentSuccess = !proc.error && proc.status === 0;
  }

  fs.writeFileSync(logFile, agentOutput, 'utf8');

  console.log(`[AI-HEAL] Agent hoàn thành. Chi tiết tiến trình: [${logRel}](${fileUrl})`);

  if (!agentSuccess) {
    console.error('\n\x1b[31m[ERROR] AI Agent execution encountered an issue. See log file above.\x1b[0m');
  }

  // Retest nếu không bị tắt
  if (options.noRetest) {
    console.log('\n[AI-HEAL] Retest skipped (--no-retest).');
    return agentSuccess;
  }

  console.log('\n[AI-HEAL] Chạy lại test để xác nhận POM đã được sửa thành công...');
  const specRel = path.relative(ROOT_DIR, specPath).replace(/\\/g, '/');
  const npxBin = resolveWindowsBinary('npx');
  const testArgs = ['playwright', 'test', specRel, '--project=chromium', '--headed'];

  const testProc = spawnSync(npxBin, testArgs, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    shell: true,
    env: { ...process.env, INTERACTIVE_SSO: '1' },
  });

  const testPassed = !testProc.error && testProc.status === 0;
  if (testPassed) {
    console.log('\n\x1b[32m🎉 [AI-HEAL SUCCESS] Test đã PASS 100% sau khi được AI sửa POM!\x1b[0m\n');
    return true;
  } else {
    console.log('\n\x1b[31m⚠️ [AI-HEAL FAILED] Test vẫn chưa pass sau 1 lần heal. Xem log tại:\x1b[0m');
    console.log(`  [${logRel}](${fileUrl})\n`);
    return false;
  }
}

// CLI entry point
if (require.main === module) {
  const argv = process.argv.slice(2);
  const positional = argv.find(a => !a.startsWith('-'));
  const key = parseKey(positional);

  if (!key) {
    console.log('\n\x1b[33mUsage: npm run heal <KEY> [--no-retest] [--cli=claude|copilot]\x1b[0m');
    console.log('   Example: npm run heal CREATE_RISK_REQUEST');
    console.log('            npm run heal SEC-11359\n');
    process.exit(1);
  }

  const noRetest = argv.includes('--no-retest');
  const cliFlag = argv.find(a => a.startsWith('--cli='));
  const cli = cliFlag ? cliFlag.split('=')[1] : undefined;

  healTest(key, { noRetest, cli }).then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('[AI-HEAL CRITICAL ERROR]', err);
    process.exit(1);
  });
}

module.exports = { healTest };
