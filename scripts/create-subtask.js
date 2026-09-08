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
 * Usage:
 *   node scripts/create-subtask.js ASAP-5568
 *   npm run create-subtask -- ASAP-5568
 *   npm run create-subtask -- ASAP-5568 --headless
 *   npm run create-subtask -- ASAP-5568 --summary "Test in DEV ASAP-5569"
 *
 * Flags / env:
 *   --headless                 : chạy ẩn (dùng khi session SSO đã hợp lệ, cho CI).
 *   --headed                   : buộc mở cửa sổ (mặc định — cần cho lần đăng nhập đầu).
 *   --summary "<text>"         : ghi đè Summary mặc định.
 *   CREATE_SUBTASK_HEADLESS=1  : tương đương --headless.
 *   JIRA_BASE_URL              : ghi đè domain Jira (mặc định https://jira.eon.com).
 *
 * Exit codes: 0 = tạo thành công HOẶC subtask đã tồn tại (idempotent);
 *             1 = lỗi (thiếu tham số / chưa đăng nhập / mạng / Jira từ chối).
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
 * Parse argv: tách parent key, cờ headless/headed và --summary "<text>".
 * key/URL và các cờ có thể xuất hiện ở bất kỳ vị trí nào (giống auto-test.js).
 */
function parseArgs(argv) {
  let summary = null;
  let headless = /^(1|true|yes)$/i.test(process.env.CREATE_SUBTASK_HEADLESS || '');
  let target = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headless') { headless = true; continue; }
    if (a === '--headed') { headless = false; continue; }
    if (a === '--summary') { summary = argv[i + 1] || null; i++; continue; }
    if (a.startsWith('--summary=')) { summary = a.slice('--summary='.length); continue; }
    if (!a.startsWith('--') && !target && /[A-Z0-9]+-\d+/i.test(a)) { target = a; }
  }
  return { parentKey: parseKey(target), summary, headless };
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

async function main() {
  const { parentKey, summary, headless } = parseArgs(process.argv.slice(2));

  if (!parentKey) {
    console.error('❌ Thiếu mã Story cha hợp lệ.');
    console.error('   Ví dụ: node scripts/create-subtask.js ASAP-5568');
    console.error('          npm run create-subtask -- ASAP-5568 [--headless] [--summary "..."]');
    process.exit(1);
  }

  const summaryText = summary || `Test in DEV ${parentKey}`;
  const parentUrl = `${JIRA_BASE_URL}/browse/${parentKey}`;

  console.log('\n======================================================');
  console.log(`⚡ Tạo Test Sub-task cho Story: \x1b[36m${parentKey}\x1b[0m`);
  console.log(`📝 Summary : \x1b[1m${summaryText}\x1b[0m`);
  console.log(`👤 Assignee: current user (Assign to me)`);
  console.log(`🔗 Parent  : \x1b[34m${parentUrl}\x1b[0m`);
  console.log('======================================================\n');

  const { context, isCdp } = await connectContext(headless);
  const page = await context.newPage();
  let exitCode = 0;

  try {
    console.log(`🔄 Đang mở Story cha để thiết lập session...`);
    await page.goto(parentUrl, { waitUntil: 'commit', timeout: 60000 });

    const authed = await waitForAuth(page, headless);
    if (!authed) {
      throw new Error(
        headless
          ? 'Chưa đăng nhập Jira ở chế độ headless. Hãy chạy lại KHÔNG kèm --headless để đăng nhập SSO lần đầu:\n' +
            `   npm run create-subtask -- ${parentKey}`
          : 'Hết thời gian chờ đăng nhập Jira (5 phút).'
      );
    }
    console.log('🎉 Session Jira hợp lệ. Đang gọi REST API tạo sub-task (0 token)...\n');

    const result = await createSubtaskViaRest(page, parentKey, summaryText);

    if (result.error) {
      if (result.error === 'NOT_AUTHENTICATED') {
        throw new Error('Session Jira không hợp lệ (401/403). Chạy lại headed để đăng nhập SSO.');
      }
      if (result.error === 'PARENT_NOT_FOUND') {
        throw new Error(`Không tìm thấy Story cha ${parentKey} (404). Kiểm tra lại mã ticket.`);
      }
      if (result.error === 'NO_SUBTASK_TYPE') {
        throw new Error('Không xác định được Issue Type "Sub-task" cho project này.');
      }
      throw new Error(result.error);
    }

    if (result.existing) {
      console.log(`\x1b[33mℹ️  Sub-task đã tồn tại (bỏ qua, idempotent):\x1b[0m ${result.key}`);
      console.log(`   ${JIRA_BASE_URL}/browse/${result.key}`);
    } else if (result.created) {
      console.log(`\x1b[32m✅ ĐÃ TẠO SUB-TASK THÀNH CÔNG:\x1b[0m \x1b[1m${result.key}\x1b[0m`);
      console.log(`   🔗 ${JIRA_BASE_URL}/browse/${result.key}`);
      console.log(`   📝 ${result.summary}`);
      if (result.assignedSeparately) {
        console.log('   👤 Assignee được gán qua bước PUT riêng (field không có trên create screen).');
      } else {
        console.log('   👤 Assignee: current user.');
      }
    }
    console.log('');
  } catch (err) {
    console.error(`\n❌ Lỗi: ${err.message}\n`);
    exitCode = 1;
  } finally {
    if (!isCdp) {
      await page.waitForTimeout(headless ? 0 : 1500);
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    } else {
      await page.close().catch(() => {});
    }
  }

  process.exit(exitCode);
}

main();
