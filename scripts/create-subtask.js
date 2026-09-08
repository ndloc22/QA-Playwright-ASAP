/**
 * ⚡ E.ON Jira Test Sub-task Creator via Playwright (0-token, pure automation)
 *
 * Thay thế prompt AI-agent `/create-test-sub-task` (mode: 'agent', click từng
 * bước trên trình duyệt -> rất tốn token) bằng tự động hoá Playwright thuần:
 * tận dụng đúng session/profile SSO Jira đã có (.auth/jira-profile) rồi gọi
 * thẳng Jira REST API (`POST /rest/api/2/issue`) NGAY TRONG page context
 * (same-origin, dùng chung cookie đăng nhập) — không tốn 1 token AI nào.
 *
 * Nó tạo một Sub-task cho Story cha với:
 *   - Summary : "Test in DEV <parent-key>"   (vd: "Test in DEV ASAP-5568")
 *   - Assignee: current user ("Assign to me")
 *   - Các trường khác: giữ mặc định của Jira (kế thừa từ story cha).
 *
 * Usage (đơn lẻ — TƯƠNG THÍCH NGƯỢC 100%):
 *   node scripts/create-subtask.js ASAP-5568
 *   npm run create-subtask -- ASAP-5568
 *   npm run create-subtask -- ASAP-5568 --headless
 *   npm run create-subtask -- ASAP-5568 --summary "Test in DEV ASAP-5569"
 *
 * Usage (Multi-ticket — Bounded Concurrency Pool):
 *   # Danh sách cách nhau bằng dấu cách
 *   npm run create-subtask -- ASAP-101 ASAP-102 ASAP-103
 *   # Chuỗi phân cách bằng dấu phẩy
 *   npm run create-subtask -- "ASAP-101, ASAP-102, ASAP-103"
 *   # Đọc từ file (mỗi dòng/phẩy/khoảng trắng đều được)
 *   npm run create-subtask -- --file tickets.txt
 *   # Chỉnh số luồng chạy song song (mặc định 3)
 *   npm run create-subtask -- ASAP-101 ASAP-102 ASAP-103 --concurrency 5
 *
 * Flags / env:
 *   --headless                 : chạy ẩn (dùng khi session SSO đã hợp lệ, cho CI).
 *   --headed                   : buộc mở cửa sổ (mặc định — cần cho lần đăng nhập đầu).
 *   --summary "<text>"         : ghi đè Summary mặc định (CHỈ áp dụng khi có đúng 1 ticket).
 *   --file <path>              : đọc danh sách ticket từ file.
 *   --concurrency <N>          : số ticket xử lý song song trong pool (mặc định 3).
 *   CREATE_SUBTASK_HEADLESS=1  : tương đương --headless.
 *   CREATE_SUBTASK_CONCURRENCY : số luồng mặc định (bị --concurrency ghi đè).
 *   JIRA_BASE_URL              : ghi đè domain Jira (mặc định https://jira.eon.com).
 *
 * Cơ chế Bounded Concurrency: khởi động trình duyệt + xác thực SSO 1 LẦN duy nhất,
 * sau đó chạy song song theo pool. Lỗi ở 1 ticket KHÔNG ảnh hưởng ticket khác.
 *
 * Exit codes: 0 = MỌI ticket đều thành công HOẶC đã tồn tại (idempotent);
 *             1 = có tối thiểu 1 lỗi (thiếu tham số / chưa đăng nhập / mạng / Jira từ chối).
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, '..', '.auth', 'jira-profile');

const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || 'https://jira.eon.com').replace(/\/+$/, '');
const JIRA_HOSTNAME = (() => {
  try { return new URL(JIRA_BASE_URL).hostname; } catch (_) { return 'jira.eon.com'; }
})();

if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function parseKey(arg) {
  if (!arg) return null;
  const m = String(arg).match(/([A-Z0-9]+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Tách 1 token bất kỳ ("ASAP-101", "ASAP-101,ASAP-102", "ASAP-101 ASAP-102")
 * thành danh sách mã ticket chuẩn hoá (chữ hoa). Bỏ qua phần rác không khớp.
 */
function extractKeys(token) {
  if (token == null) return [];
  return String(token)
    .split(/[\s,;]+/)
    .map((t) => parseKey(t))
    .filter(Boolean);
}

/**
 * Lọc trùng (deduplicate) nhưng GIỮ THỨ TỰ xuất hiện đầu tiên.
 */
function dedupe(keys) {
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/**
 * Parse argv: tách danh sách parent key (multi-ticket), cờ headless/headed,
 * --summary, --file <path> và --concurrency N. Key/URL và các cờ có thể xuất
 * hiện ở bất kỳ vị trí nào (giống auto-test.js). Không throw — mọi lỗi đọc file
 * được trả về qua trường `fileError` để phía main xử lý graceful.
 */
function parseArgs(argv) {
  let summary = null;
  let headless = /^(1|true|yes)$/i.test(process.env.CREATE_SUBTASK_HEADLESS || '');
  let filePath = null;
  let fileError = null;

  const envConc = parseInt(process.env.CREATE_SUBTASK_CONCURRENCY || '', 10);
  let concurrency = Number.isFinite(envConc) && envConc > 0 ? envConc : 3;

  const rawTokens = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headless') { headless = true; continue; }
    if (a === '--headed') { headless = false; continue; }
    if (a === '--summary') { summary = argv[i + 1] || null; i++; continue; }
    if (a.startsWith('--summary=')) { summary = a.slice('--summary='.length); continue; }
    if (a === '--file') { filePath = argv[i + 1] || null; i++; continue; }
    if (a.startsWith('--file=')) { filePath = a.slice('--file='.length); continue; }
    if (a === '--concurrency') {
      const n = parseInt(argv[i + 1] || '', 10);
      if (Number.isFinite(n) && n > 0) concurrency = n;
      i++; continue;
    }
    if (a.startsWith('--concurrency=')) {
      const n = parseInt(a.slice('--concurrency='.length), 10);
      if (Number.isFinite(n) && n > 0) concurrency = n;
      continue;
    }
    if (!a.startsWith('--')) { rawTokens.push(a); }
  }

  const keys = [];
  for (const tok of rawTokens) keys.push(...extractKeys(tok));

  if (filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Bỏ dòng comment bắt đầu bằng '#'.
      for (const line of content.split(/\r?\n/)) {
        const stripped = line.replace(/#.*$/, '');
        keys.push(...extractKeys(stripped));
      }
    } catch (e) {
      fileError = `Không đọc được file "${filePath}": ${e.message}`;
    }
  }

  return { parentKeys: dedupe(keys), summary, headless, concurrency, filePath, fileError };
}

/**
 * Gọi toàn bộ luồng REST NGAY TRONG page context (same-origin với Jira) để
 * dùng chung cookie session SSO. Trả về object mô tả kết quả — mọi lỗi được
 * trả về dưới dạng { error } để phía Node xử lý graceful, không throw giữa chừng.
 */
async function createSubtaskViaRest(page, parentKey, summaryText) {
  return page.evaluate(async ({ parentKey, summaryText }) => {
    const jsonHeaders = { Accept: 'application/json' };
    const postHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Atlassian-Token': 'no-check'
    };

    // 0. Xác nhận đã đăng nhập (myself trả 200 kèm name/accountId).
    const meRes = await fetch('/rest/api/2/myself', { credentials: 'include', headers: jsonHeaders });
    if (meRes.status === 401 || meRes.status === 403) {
      return { error: 'NOT_AUTHENTICATED', status: meRes.status };
    }
    if (!meRes.ok) {
      return { error: `myself HTTP ${meRes.status}` };
    }
    const me = await meRes.json();

    // 1. Đọc issue cha để lấy project + danh sách subtasks hiện có.
    const pRes = await fetch(
      `/rest/api/2/issue/${encodeURIComponent(parentKey)}?fields=project,issuetype,summary,subtasks`,
      { credentials: 'include', headers: jsonHeaders }
    );
    if (pRes.status === 404) return { error: `PARENT_NOT_FOUND` };
    if (!pRes.ok) return { error: `parent HTTP ${pRes.status}` };
    const parent = await pRes.json();
    const project = parent.fields && parent.fields.project;
    if (!project || !project.id) return { error: 'NO_PROJECT_ON_PARENT' };

    // 1b. Idempotent: nếu đã có subtask trùng Summary -> báo tồn tại, không tạo lại.
    const existing = (parent.fields.subtasks || []).find(
      (s) => s && s.fields && s.fields.summary === summaryText
    );
    if (existing) {
      return { existing: true, key: existing.key, parentKey, summary: summaryText };
    }

    // 2. Tìm issue type là Sub-task cho project này qua createmeta.
    let subtaskTypeId = null;
    try {
      const metaRes = await fetch(
        `/rest/api/2/issue/createmeta?projectKeys=${encodeURIComponent(project.key)}&expand=projects.issuetypes`,
        { credentials: 'include', headers: jsonHeaders }
      );
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const proj = (meta.projects || []).find((p) => p.id === project.id || p.key === project.key);
        const st = (proj && proj.issuetypes || []).find((it) => it.subtask === true);
        if (st) subtaskTypeId = st.id;
      }
    } catch (_) { /* fallback bên dưới */ }

    // Fallback: quét toàn bộ issue types của instance để tìm cái có subtask=true.
    if (!subtaskTypeId) {
      try {
        const itRes = await fetch('/rest/api/2/issuetype', { credentials: 'include', headers: jsonHeaders });
        if (itRes.ok) {
          const all = await itRes.json();
          const st = (all || []).find((it) => it.subtask === true);
          if (st) subtaskTypeId = st.id;
        }
      } catch (_) { /* ignore */ }
    }

    if (!subtaskTypeId) return { error: 'NO_SUBTASK_TYPE' };

    // 3. Tạo subtask. Assignee = current user ("Assign to me").
    //    Jira Server/DC dùng `name`; Jira Cloud dùng `accountId`.
    const assignee = me.accountId ? { accountId: me.accountId } : { name: me.name };
    const fields = {
      project: { id: project.id },
      parent: { key: parentKey },
      summary: summaryText,
      issuetype: { id: subtaskTypeId },
      assignee
    };

    let cRes = await fetch('/rest/api/2/issue', {
      method: 'POST',
      credentials: 'include',
      headers: postHeaders,
      body: JSON.stringify({ fields })
    });

    // 3b. Nếu bị từ chối vì field assignee không nằm trên create screen,
    //     tạo lại KHÔNG kèm assignee rồi gán riêng qua PUT .../assignee.
    if (!cRes.ok && (cRes.status === 400)) {
      let bodyText = '';
      try { bodyText = JSON.stringify(await cRes.clone().json()); } catch (_) {}
      if (/assignee/i.test(bodyText)) {
        const fieldsNoAssignee = { ...fields };
        delete fieldsNoAssignee.assignee;
        cRes = await fetch('/rest/api/2/issue', {
          method: 'POST',
          credentials: 'include',
          headers: postHeaders,
          body: JSON.stringify({ fields: fieldsNoAssignee })
        });
        if (cRes.ok) {
          const created = await cRes.json();
          // Best-effort assign; không fail cả luồng nếu gán không được.
          try {
            await fetch(`/rest/api/2/issue/${created.key}/assignee`, {
              method: 'PUT',
              credentials: 'include',
              headers: postHeaders,
              body: JSON.stringify(assignee)
            });
          } catch (_) { /* ignore */ }
          return { created: true, key: created.key, parentKey, summary: summaryText, assignedSeparately: true };
        }
      }
    }

    if (!cRes.ok) {
      let detail = `HTTP ${cRes.status}`;
      try {
        const errJson = await cRes.json();
        const msgs = []
          .concat(errJson.errorMessages || [])
          .concat(Object.values(errJson.errors || {}));
        if (msgs.length) detail += ` — ${msgs.join('; ')}`;
      } catch (_) { /* keep status only */ }
      return { error: `CREATE_FAILED: ${detail}` };
    }

    const created = await cRes.json();
    return { created: true, key: created.key, parentKey, summary: summaryText };
  }, { parentKey, summaryText });
}

async function connectContext(headless) {
  // 1. Ưu tiên tái sử dụng Chrome đang mở qua CDP (port 9222) như fetch-jira.js.
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222', { timeout: 2000 });
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      console.log('✅ Đã kết nối vào Chrome đang mở (CDP port 9222).');
      return { context: contexts[0], isCdp: true };
    }
  } catch (_) { /* không có CDP -> mở profile */ }

  // 2. Mở Chrome với persistent profile SSO đã lưu.
  console.log(`🌐 Đang khởi động Chrome (Profile SSO: .auth/jira-profile, headless=${headless})...`);
  try {
    const context = await chromium.launchPersistentContext(AUTH_DIR, {
      channel: 'chrome',
      headless,
      viewport: { width: 1400, height: 900 },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check'
      ]
    });
    return { context, isCdp: false };
  } catch (_) {
    console.warn('⚠️ Fallback sang Chromium mặc định...');
    const context = await chromium.launchPersistentContext(AUTH_DIR, {
      headless,
      viewport: { width: 1400, height: 900 }
    });
    return { context, isCdp: false };
  }
}

/**
 * Chờ đăng nhập SSO thật (chỉ có ý nghĩa khi headed). Poll cho tới khi
 * /rest/api/2/myself trả 200 trên đúng domain Jira. Ở headless, nếu chưa
 * đăng nhập sẽ hết thời gian nhanh và báo lỗi hướng dẫn chạy lại headed.
 */
async function waitForAuth(page, headless) {
  const maxWaitMs = headless ? 15000 : 300000; // headless: 15s; headed: 5 phút cho SSO/2FA
  const pollInterval = 1500;
  let elapsed = 0;

  if (!headless) {
    console.log('\n⏳ Nếu Jira yêu cầu đăng nhập SSO/2FA, Sếp cứ thao tác trên cửa sổ Chrome.');
    console.log('   Script sẽ chờ tới khi phiên đăng nhập hợp lệ (tối đa 5 phút)...\n');
  }

  while (elapsed < maxWaitMs) {
    const currentUrl = page.url();
    const onJira = currentUrl.includes(JIRA_HOSTNAME) &&
      !currentUrl.includes('login.microsoftonline.com') &&
      !currentUrl.includes('login.live.com') &&
      !currentUrl.includes('adfs');

    if (onJira) {
      try {
        const ok = await page.evaluate(async () => {
          const r = await fetch('/rest/api/2/myself', {
            credentials: 'include', headers: { Accept: 'application/json' }
          });
          return r.ok;
        });
        if (ok) return true;
      } catch (_) { /* điều hướng đang diễn ra */ }
    }

    await page.waitForTimeout(pollInterval);
    elapsed += pollInterval;
    if (!headless && elapsed % 15000 === 0) {
      console.log(`⏳ Đang chờ đăng nhập... (${Math.round(elapsed / 1000)}s / 300s)`);
    }
  }
  return false;
}

/**
 * Chuẩn hoá kết quả thô từ createSubtaskViaRest thành 1 dòng cho bảng tổng kết.
 * status ∈ 'created' | 'existing' | 'error'.
 */
function toRow(parentKey, result) {
  if (!result) return { parentKey, status: 'error', error: 'UNKNOWN' };
  if (result.error) {
    const map = {
      NOT_AUTHENTICATED: 'Session không hợp lệ (401/403)',
      PARENT_NOT_FOUND: 'Không tìm thấy Story cha (404)',
      NO_SUBTASK_TYPE: 'Không có Issue Type "Sub-task"',
      NO_PROJECT_ON_PARENT: 'Parent không có project'
    };
    return { parentKey, status: 'error', error: map[result.error] || result.error };
  }
  if (result.existing) {
    return { parentKey, status: 'existing', key: result.key, link: `${JIRA_BASE_URL}/browse/${result.key}` };
  }
  if (result.created) {
    return {
      parentKey, status: 'created', key: result.key,
      link: `${JIRA_BASE_URL}/browse/${result.key}`,
      assignedSeparately: !!result.assignedSeparately
    };
  }
  return { parentKey, status: 'error', error: 'UNKNOWN_RESULT' };
}

const STATUS_LABEL = { created: 'Đã tạo mới', existing: 'Đã tồn tại', error: 'Lỗi' };
const STATUS_ICON = { created: '✅', existing: 'ℹ️ ', error: '❌' };

function pad(str, len) {
  const s = String(str == null ? '' : str);
  return s + ' '.repeat(Math.max(0, len - s.length));
}

/**
 * In bảng tổng kết đẹp mắt (khung kẻ) + dòng tổng hợp số lượng theo trạng thái.
 */
function printSummaryTable(rows) {
  const headers = ['#', 'Ticket cha', 'Trạng thái', 'Subtask Key', 'Link Jira'];
  const data = rows.map((r, i) => [
    String(i + 1),
    r.parentKey,
    STATUS_LABEL[r.status] || r.status,
    r.status === 'error' ? '—' : (r.key || '—'),
    r.status === 'error' ? (r.error || '—') : (r.link || '—')
  ]);

  const widths = headers.map((h, c) =>
    Math.max(h.length, ...data.map((row) => String(row[c]).length))
  );

  const line = (l, m, rr) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + rr;
  const rowStr = (cells) => '│ ' + cells.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │';

  console.log('\n' + line('┌', '┬', '┐'));
  console.log(rowStr(headers));
  console.log(line('├', '┼', '┤'));
  for (const row of data) console.log(rowStr(row));
  console.log(line('└', '┴', '┘'));

  const created = rows.filter((r) => r.status === 'created').length;
  const existing = rows.filter((r) => r.status === 'existing').length;
  const errored = rows.filter((r) => r.status === 'error').length;
  console.log(
    `\n📊 Tổng kết: ${rows.length} ticket — ` +
    `\x1b[32m${created} tạo mới\x1b[0m, ` +
    `\x1b[33m${existing} đã tồn tại\x1b[0m, ` +
    `\x1b[31m${errored} lỗi\x1b[0m.\n`
  );
}

/**
 * Bounded Concurrency Pool: nhiều "worker" (mỗi worker 1 page dùng chung
 * context/cookie SSO) cùng rút ticket từ 1 hàng đợi cho tới khi cạn. Nhờ đó
 * trình duyệt + SSO chỉ khởi tạo 1 lần, còn việc tạo subtask chạy song song.
 * Lỗi 1 ticket được nuốt tại chỗ (ghi vào results) nên không lan sang ticket khác.
 */
async function runPool(context, tickets, opts) {
  const { concurrency, summaryOverride } = opts;
  const results = new Array(tickets.length);
  const total = tickets.length;
  let nextIndex = 0;
  let done = 0;

  const workerCount = Math.max(1, Math.min(concurrency, total));

  async function worker(page) {
    while (true) {
      const i = nextIndex++;
      if (i >= total) break;
      const parentKey = tickets[i];
      const summaryText = (summaryOverride && total === 1) ? summaryOverride : `Test in DEV ${parentKey}`;
      let row;
      try {
        await page.goto(`${JIRA_BASE_URL}/browse/${parentKey}`, { waitUntil: 'commit', timeout: 60000 });
        const result = await createSubtaskViaRest(page, parentKey, summaryText);
        row = toRow(parentKey, result);
      } catch (err) {
        row = { parentKey, status: 'error', error: err.message };
      }
      results[i] = row;
      done++;
      const icon = STATUS_ICON[row.status] || '•';
      const detail = row.status === 'error' ? row.error : (row.key || '');
      console.log(`   [${done}/${total}] ${icon} ${parentKey} → ${detail} (${STATUS_LABEL[row.status]})`);
    }
  }

  // Worker đầu tiên tái dùng page đã xác thực; các worker còn lại mở page mới
  // (cùng context nên dùng chung session SSO đã đăng nhập).
  const pages = [opts.authedPage];
  for (let i = 1; i < workerCount; i++) pages.push(await context.newPage());

  await Promise.all(pages.map((p) => worker(p)));

  // Đóng các page phụ (giữ page đã xác thực để finally của main dọn dẹp).
  for (let i = 1; i < pages.length; i++) await pages[i].close().catch(() => {});

  return results;
}

async function main() {
  const { parentKeys, summary, headless, concurrency, filePath, fileError } = parseArgs(process.argv.slice(2));

  if (fileError) {
    console.error(`❌ ${fileError}`);
    process.exit(1);
  }

  if (!parentKeys.length) {
    console.error('❌ Thiếu mã Story cha hợp lệ.');
    console.error('   Đơn lẻ  : node scripts/create-subtask.js ASAP-5568');
    console.error('   Nhiều   : npm run create-subtask -- ASAP-101 ASAP-102 ASAP-103');
    console.error('   Dấu phẩy: npm run create-subtask -- "ASAP-101, ASAP-102"');
    console.error('   Từ file : npm run create-subtask -- --file tickets.txt');
    process.exit(1);
  }

  const isMulti = parentKeys.length > 1;
  const effConcurrency = Math.max(1, Math.min(concurrency, parentKeys.length));

  if (summary && isMulti) {
    console.warn('⚠️  --summary chỉ áp dụng cho ticket đơn lẻ — bỏ qua khi có nhiều ticket.');
  }

  console.log('\n======================================================');
  if (isMulti) {
    console.log(`⚡ Tạo Test Sub-task cho \x1b[36m${parentKeys.length}\x1b[0m Story (Bounded Concurrency Pool)`);
    console.log(`🎫 Tickets   : \x1b[1m${parentKeys.join(', ')}\x1b[0m`);
    console.log(`🧵 Concurrency: ${effConcurrency}`);
  } else {
    const summaryText = summary || `Test in DEV ${parentKeys[0]}`;
    console.log(`⚡ Tạo Test Sub-task cho Story: \x1b[36m${parentKeys[0]}\x1b[0m`);
    console.log(`📝 Summary : \x1b[1m${summaryText}\x1b[0m`);
  }
  console.log(`👤 Assignee: current user (Assign to me)`);
  console.log('======================================================\n');

  const { context, isCdp } = await connectContext(headless);
  const authedPage = await context.newPage();
  let exitCode = 0;

  try {
    console.log(`🔄 Đang mở Jira để thiết lập & xác thực session (1 lần)...`);
    const firstUrl = `${JIRA_BASE_URL}/browse/${parentKeys[0]}`;
    await authedPage.goto(firstUrl, { waitUntil: 'commit', timeout: 60000 });

    const authed = await waitForAuth(authedPage, headless);
    if (!authed) {
      throw new Error(
        headless
          ? 'Chưa đăng nhập Jira ở chế độ headless. Hãy chạy lại KHÔNG kèm --headless để đăng nhập SSO lần đầu:\n' +
            `   npm run create-subtask -- ${parentKeys.join(' ')}`
          : 'Hết thời gian chờ đăng nhập Jira (5 phút).'
      );
    }
    console.log('🎉 Session Jira hợp lệ. Đang tạo sub-task (0 token)...\n');

    const results = await runPool(context, parentKeys, {
      concurrency: effConcurrency,
      summaryOverride: summary,
      authedPage
    });

    printSummaryTable(results);

    if (results.some((r) => r.status === 'error')) exitCode = 1;
  } catch (err) {
    console.error(`\n❌ Lỗi: ${err.message}\n`);
    exitCode = 1;
  } finally {
    if (!isCdp) {
      await authedPage.waitForTimeout(headless ? 0 : 1500);
      await authedPage.close().catch(() => {});
      await context.close().catch(() => {});
    } else {
      await authedPage.close().catch(() => {});
    }
  }

  process.exit(exitCode);
}

module.exports = { parseKey, extractKeys, dedupe, parseArgs, toRow, printSummaryTable };

if (require.main === module) {
  main();
}
