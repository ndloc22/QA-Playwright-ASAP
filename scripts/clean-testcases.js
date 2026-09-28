/**
 * 🧹 Clean Testcase Artifacts with Safety Backup
 *
 * Xóa sạch các file testcase đã sinh ra để tester có thể record lại từ đầu,
 * đồng thời tự động lưu một bản backup vào thư mục scratch đề phòng khi cần.
 *
 * Cách dùng:
 *   npm run clean:testcase
 *   node scripts/clean-testcases.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = path.join(ROOT, '.backup_testcases', `backup_${timestamp}`);

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const targets = [
  { dir: path.join(ROOT, 'tests', 'recordings', 'functions'), pattern: /\.recording\.ts$/ },
  { dir: path.join(ROOT, 'tests', 'pages', 'functions'),      pattern: /\.ts$/ },
  { dir: path.join(ROOT, 'tests', 'e2e', 'functions'),        pattern: /\.spec\.ts$/ },
  { dir: path.join(ROOT, 'tests', 'testcases', 'functions'),  pattern: /\.md$/ },
];

let total = 0;
for (const { dir, pattern } of targets) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => pattern.test(f) && f !== '.gitkeep' && f !== '_TEMPLATE.md');
  for (const file of files) {
    const full = path.join(dir, file);
    fs.copyFileSync(full, path.join(BACKUP_DIR, file));
    fs.rmSync(full);
    console.log(`[DEL] ${path.relative(ROOT, full)}`);
    total++;
  }
}

const liveYaml = path.join(ROOT, 'docs', 'specs', 'codebase', 'live_grounded_components.yaml');
if (fs.existsSync(liveYaml)) {
  fs.copyFileSync(liveYaml, path.join(BACKUP_DIR, 'live_grounded_components.yaml'));
  fs.rmSync(liveYaml);
  console.log(`[DEL] ${path.relative(ROOT, liveYaml)}`);
  total++;
}

const testResultsDir = path.join(ROOT, 'test-results');
if (fs.existsSync(testResultsDir)) {
  try {
    fs.rmSync(testResultsDir, { recursive: true, force: true });
    console.log('[CLEAN] test-results directory');
  } catch (_) {}
}

console.log(`\n✅ Da don sach ${total} file testcase. (Backup an toan tai: ${path.relative(ROOT, BACKUP_DIR)})\n`);
