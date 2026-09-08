/**
 * ⚡ E.ON Jira Ticket Browser Fetcher via Playwright (Robust SSO + Anti-Premature-Close)
 * Usage:
 *   node scripts/fetch-jira.js KFWT-1161
 *   npm run fetch-ticket -- KFWT-1161
 */

const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const TICKETS_DIR = path.join(__dirname, '..', 'docs', 'tickets');
const AUTH_DIR = path.join(__dirname, '..', '.auth', 'jira-profile');

// Tham so hoa JIRA_BASE_URL de tai su dung script nay cho cac du an khac (ASAP, WAW, ...).
// Uu tien bien moi truong JIRA_BASE_URL, fallback ve domain E.ON mac dinh.
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL || 'https://jira.eon.com').replace(/\/+$/, '');
const JIRA_HOSTNAME = (() => {
  try { return new URL(JIRA_BASE_URL).hostname; } catch (_) { return 'jira.eon.com'; }
})();

// Attachment/image co the bo qua vi la icon/avatar/badge UI rac, khong phai mockup/diagram thuc.
const ICON_URL_PATTERN = /avatar|icon|emoji|gravatar|useravatar|noimage|no-image|badge|severity|smiley|profile|logo|favicon|spinner|throbber/i;
// Nguong kich thuoc toi thieu (bytes) de coi mot file la mockup/diagram thuc su, khong phai icon nho.
const MIN_ATTACHMENT_BYTES = 50 * 1024; // 50KB

if (!fs.existsSync(TICKETS_DIR)) {
  fs.mkdirSync(TICKETS_DIR, { recursive: true });
}
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function parseTicketKey(arg) {
  if (!arg) return null;
  const match = arg.match(/([A-Z0-9]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function sanitizeFilename(name) {
  return (name || 'file')
    .split('?')[0]
    .split('#')[0]
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-120) || 'file';
}

/**
 * Quét DOM thật (khong phai HTML string) de tim toan bo:
 *  - the <img src> (mockup/screenshot dinh kem trong Description/AC)
 *  - the <a href="/secure/attachment/...">  (file dinh kem Jira)
 * Chi tim trong cac vung noi dung pho bien cua Jira (Description/AC/custom field)
 * de tranh vet phai icon/logo giao dien khong lien quan.
 */
async function collectAttachmentUrls(page) {
  return page.evaluate(() => {
    const contentSelectors = [
      '#description-val',
      '[data-test-id*="description"]',
      '.ak-renderer-document',
      '#descriptionmodule .user-content-block',
      '.item-details', '.property-list',
      '#viewissuesidebar', '#issue_actions_container'
    ];
    const roots = new Set();
    contentSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => roots.add(el));
    });
    // Neu khong tim thay vung noi dung chuan nao -> fallback toan bo <body>
    if (roots.size === 0) roots.add(document.body);

    const images = new Set();
    const attachments = new Set();

    roots.forEach(root => {
      root.querySelectorAll('img[src]').forEach(img => {
        try {
          const abs = new URL(img.getAttribute('src'), window.location.href).href;
          images.add(abs);
        } catch (_) {}
      });
      root.querySelectorAll('a[href*="/secure/attachment/"]').forEach(a => {
        try {
          const abs = new URL(a.getAttribute('href'), window.location.href).href;
          attachments.add(abs);
        } catch (_) {}
      });
    });

    return { images: Array.from(images), attachments: Array.from(attachments) };
  });
}

/**
 * Tai file nhi phan (anh + attachment) qua authenticated context request cua Playwright
 * (dung chung cookie/session voi trinh duyet dang dang nhap) -> luu vao
 * docs/tickets/<KEY>/attachments/
 *
 * Bo loc rac: BO QUA hoan toan avatar/icon/emoji/badge (theo pattern URL) va bat ky file
 * nao nho hon MIN_ATTACHMENT_BYTES (mac dinh 50KB) -- vi day thuong la icon UI, khong phai
 * mockup/diagram thuc su can cho AI grounding. Chi giu lai file du "nang" de la anh/tai lieu that.
 */
async function downloadAttachments(browserContext, urls, destDir) {
  const downloaded = [];
  for (const url of urls) {
    if (ICON_URL_PATTERN.test(url)) {
      console.log(`   ⏭️  Bo qua icon/avatar/badge (URL pattern): ${url}`);
      continue;
    }
    try {
      const response = await browserContext.request.get(url, { timeout: 30000 });
      if (!response.ok()) {
        console.warn(`   ⚠️  Bo qua (HTTP ${response.status()}): ${url}`);
        continue;
      }
      const buffer = await response.body();
      if (buffer.length < MIN_ATTACHMENT_BYTES) {
        console.log(`   ⏭️  Bo qua file qua nho (${(buffer.length / 1024).toFixed(1)}KB < 50KB, co the la icon/avatar): ${url}`);
        continue;
      }
      let filename = sanitizeFilename(decodeURIComponent(path.basename(new URL(url).pathname)));
      // Ticket voi ID attachment dang /secure/attachment/12345/name.png -> giu ten that
      if (!path.extname(filename)) {
        const ct = response.headers()['content-type'] || '';
        const extGuess = ct.includes('png') ? '.png' : ct.includes('jpeg') ? '.jpg' : ct.includes('gif') ? '.gif' : ct.includes('pdf') ? '.pdf' : '';
        filename += extGuess;
      }
      let finalPath = path.join(destDir, filename);
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        finalPath = path.join(destDir, `${base}-${counter}${ext}`);
        counter++;
      }
      fs.writeFileSync(finalPath, buffer);
      downloaded.push({ url, localPath: finalPath, filename: path.basename(finalPath) });
      console.log(`   ✅ Tai xong (${(buffer.length / 1024).toFixed(1)}KB): ${path.basename(finalPath)}`);
    } catch (err) {
      console.warn(`   ⚠️  Loi khi tai ${url}: ${err.message}`);
    }
  }
  return downloaded;
}

function resolveUrl(arg) {
  if (!arg) return null;
  if (arg.startsWith('http://') || arg.startsWith('https://')) return arg;
  const key = parseTicketKey(arg);
  return key ? `${JIRA_BASE_URL}/browse/${key}` : null;
}

async function fetchJiraTicket(target) {
  const url = resolveUrl(target);
  const key = parseTicketKey(target);

  if (!url || !key) {
    console.error('❌ Vui lòng cung cấp URL hoặc mã Jira Ticket hợp lệ!');
    console.error('Ví dụ: node scripts/fetch-jira.js KFWT-1161');
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`⚡ Bắt đầu bóc tách Jira Ticket: \x1b[36m${key}\x1b[0m`);
  console.log(`🔗 URL: \x1b[34m${url}\x1b[0m`);
  console.log(`======================================================\n`);

  let browserContext;
  let isCdp = false;

  // 1. Thử kết nối Chrome đang mở sẵn qua CDP (port 9222)
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222', { timeout: 2000 });
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      browserContext = contexts[0];
      isCdp = true;
      console.log('✅ Đã kết nối vào Chrome đang mở của Sếp (CDP port 9222)!');
    }
  } catch (_) {}

  // 2. Nếu không có CDP, mở Chrome với persistent profile
  if (!browserContext) {
    console.log('🌐 Đang khởi động Google Chrome (Profile lưu trữ tại .auth/jira-profile)...');
    try {
      browserContext = await chromium.launchPersistentContext(AUTH_DIR, {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1400, height: 900 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-default-browser-check',
          '--start-maximized'
        ]
      });
    } catch (launchErr) {
      console.warn('⚠️ Fallback sang Chromium mặc định...');
      browserContext = await chromium.launchPersistentContext(AUTH_DIR, {
        headless: false,
        viewport: { width: 1400, height: 900 }
      });
    }
  }

  const page = await browserContext.newPage();

  try {
    console.log(`🔄 Đang điều hướng tới: ${url}...`);
    await page.goto(url, { waitUntil: 'commit', timeout: 60000 });

    // 3. VÒNG LẶP CHỜ ĐĂNG NHẬP THẬT (Anti-Premature Close)
    // Tuyệt đối KHÔNG kiểm tra u.href.includes(key) vì trang login Microsoft có chứa key trong query redirect!
    console.log('\n⏳ \x1b[33mĐang kiểm tra trạng thái đăng nhập...\x1b[0m');
    console.log('👉 Nếu màn hình yêu cầu đăng nhập SSO / 2FA Microsoft, Sếp cứ thong thả thao tác trên cửa sổ Chrome.');
    console.log('⏳ Script sẽ kiên nhẫn chờ đến khi vào được đúng trang Jira ticket (tối đa 5 phút)...\n');

    const maxWaitMs = 300000; // 5 phút
    const pollInterval = 1500;
    let elapsed = 0;
    let authenticated = false;

    while (elapsed < maxWaitMs) {
      const currentUrl = page.url();
      const isMicrosoftLogin = currentUrl.includes('login.microsoftonline.com') || 
                               currentUrl.includes('login.live.com') ||
                               currentUrl.includes('adfs');

      if (!isMicrosoftLogin && currentUrl.includes(JIRA_HOSTNAME)) {
        // Kiểm tra xem đã có phần tử Jira thật trong DOM chưa
        try {
          const isJiraReady = await page.evaluate((ticketKey) => {
            const hasSummary = !!document.querySelector('#summary-val') || 
                               !!document.querySelector('h1[data-test-id*="summary"]') ||
                               (document.title && document.title.includes(ticketKey));
            const hasKey = !!document.querySelector('#key-val') || 
                           (window.location.pathname && window.location.pathname.includes(ticketKey));
            const notLoginPage = !document.querySelector('#login-form') && !document.querySelector('form[name="loginform"]');
            return (hasSummary || hasKey) && notLoginPage;
          }, key);

          if (isJiraReady) {
            authenticated = true;
            console.log('🎉 \x1b[32mĐÃ XÁC NHẬN VÀO ĐƯỢC TRANG JIRA TICKET THÀNH CÔNG!\x1b[0m');
            break;
          }
        } catch (_) {}
      }

      await page.waitForTimeout(pollInterval);
      elapsed += pollInterval;

      if (elapsed % 15000 === 0) {
        console.log(`⏳ Đang chờ đăng nhập... (${Math.round(elapsed / 1000)}s / 300s)`);
      }
    }

    if (!authenticated) {
      throw new Error('Hết thời gian chờ đăng nhập (5 phút) hoặc chưa vào được trang ticket Jira.');
    }

    // Đợi thêm 3s để DOM hydration và REST API sẵn sàng
    console.log('⏳ Đang đợi nội dung ticket tải hoàn tất...');
    await page.waitForTimeout(3000);

    // 4. Bóc tách dữ liệu
    console.log('📥 Đang trích xuất dữ liệu từ Jira...');
    const ticketData = await page.evaluate(async (ticketKey) => {
      let restData = null;

      // Cách 1: Thử Jira REST API qua session cookie
      try {
        const res = await fetch(`/rest/api/2/issue/${ticketKey}?expand=renderedFields,names&fields=*all,comment`, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          const json = await res.json();
          const fields = json.fields || {};
          const rendered = json.renderedFields || {};
          const names = json.names || {};

          let storyPoints = null;
          let acceptanceCriteria = null;
          let sprint = null;

          for (const [cfId, cfName] of Object.entries(names)) {
            const lower = cfName.toLowerCase();
            if (lower.includes('point') && fields[cfId] !== undefined) {
              storyPoints = fields[cfId];
            }
            if ((lower.includes('acceptance') || lower.includes('criteria') || lower.includes('tiêu chí')) && fields[cfId]) {
              acceptanceCriteria = rendered[cfId] || fields[cfId];
            }
            if (lower.includes('sprint') && fields[cfId]) {
              const spVal = fields[cfId];
              if (Array.isArray(spVal) && spVal.length) {
                const last = spVal[spVal.length - 1];
                sprint = typeof last === 'string' ? (last.match(/name=([^,\]]+)/) || [,''])[1] : (last.name || '');
              } else if (typeof spVal === 'string') {
                sprint = (spVal.match(/name=([^,\]]+)/) || [,''])[1] || spVal;
              }
            }
          }

          // Trích xuất Comments (fields.comment.comments) — nguồn "Resolution Authority": khi
          // PO/Dev đã chốt cách xử lý mâu thuẫn nghiệp vụ (vd 1 task vs 2 task) trực tiếp trong
          // Jira Comments, đây là bằng chứng thoả thuận mới nhất, có thẩm quyền cao hơn Description/AC gốc.
          const rawComments = (fields.comment && Array.isArray(fields.comment.comments)) ? fields.comment.comments : [];
          const renderedComments = (rendered.comment && Array.isArray(rendered.comment.comments)) ? rendered.comment.comments : [];
          const comments = rawComments.map((c, idx) => {
            const renderedMatch = renderedComments[idx] || {};
            return {
              author: (c.updateAuthor && c.updateAuthor.displayName) || (c.author && c.author.displayName) || 'Unknown',
              created: c.created || c.updated || '',
              body: (renderedMatch.body || c.body || '').toString()
            };
          });

          restData = {
            key: ticketKey,
            summary: fields.summary || '',
            description: rendered.description || fields.description || '',
            acceptanceCriteria: acceptanceCriteria || '',
            issueType: fields.issuetype ? fields.issuetype.name : 'Story',
            status: fields.status ? fields.status.name : 'To Do',
            priority: fields.priority ? fields.priority.name : 'Medium',
            assignee: fields.assignee ? fields.assignee.displayName : 'Unassigned',
            reporter: fields.reporter ? fields.reporter.displayName : 'N/A',
            sprint: sprint || '',
            storyPoints: storyPoints,
            labels: fields.labels || [],
            components: (fields.components || []).map(c => c.name),
            comments: comments,
            source: 'REST_API'
          };
        }
      } catch (e) {}

      // Cách 2: Bóc tách trực tiếp từ DOM Jira
      if (!restData || !restData.summary) {
        const summaryEl = document.querySelector('#summary-val') || 
                          document.querySelector('h1[data-test-id*="summary"]') || 
                          document.querySelector('h1');
        
        // Trích xuất Title từ document.title nếu selector bị đổi: "[KFWT-1161] Title here - Jira"
        let fallbackTitle = '';
        if (document.title && document.title.includes(ticketKey)) {
          fallbackTitle = document.title
            .replace(new RegExp(`\\[?${ticketKey}\\]?\\s*[:-]?\\s*`, 'i'), '')
            .replace(/\s*-\s*(Jira|E\.ON).*$/i, '')
            .trim();
        }

        const descEl = document.querySelector('#description-val') || 
                       document.querySelector('[data-test-id*="description"]') || 
                       document.querySelector('#descriptionmodule .user-content-block') ||
                       document.querySelector('.ak-renderer-document');

        const statusEl = document.querySelector('#status-val') || document.querySelector('.jira-issue-status-lozenge');
        const typeEl = document.querySelector('#type-val');
        const priorityEl = document.querySelector('#priority-val');
        const assigneeEl = document.querySelector('#assignee-val');
        const reporterEl = document.querySelector('#reporter-val');

        // Tìm Acceptance Criteria trong custom fields
        let domAC = '';
        const customFieldEls = document.querySelectorAll('.item-details dl, .property-list dl');
        for (const dl of customFieldEls) {
          const dt = dl.querySelector('dt')?.innerText?.toLowerCase() || '';
          if (dt.includes('acceptance') || dt.includes('criteria')) {
            domAC = dl.querySelector('dd')?.innerText?.trim() || '';
            break;
          }
        }

        // DOM fallback cho Comments (Jira Server/DC classic layout) — nguồn Resolution Authority
        // khi REST API không trả về (quyền hạn/permission) nhưng comment vẫn hiển thị trên trang.
        const domComments = [];
        document.querySelectorAll('.activity-comment, div[id^="comment-"]').forEach(node => {
          const authorEl = node.querySelector('.action-details .user-hover, .action-head .user-hover, a.user-hover, .twixi-name');
          const dateEl = node.querySelector('.action-details time, .date, time');
          const bodyEl = node.querySelector('.action-body, .comment-body, .twixi-wrap .action-body');
          const body = bodyEl ? bodyEl.innerHTML : '';
          if (!body) return;
          domComments.push({
            author: authorEl ? authorEl.innerText.trim() : 'Unknown',
            created: dateEl ? (dateEl.getAttribute('datetime') || dateEl.innerText.trim()) : '',
            body
          });
        });

        restData = {
          key: ticketKey,
          summary: summaryEl ? summaryEl.innerText.trim() : fallbackTitle,
          description: descEl ? descEl.innerText.trim() : '',
          acceptanceCriteria: domAC,
          issueType: typeEl ? typeEl.innerText.trim() : 'Story',
          status: statusEl ? statusEl.innerText.trim() : 'To Do',
          priority: priorityEl ? priorityEl.innerText.trim() : 'Medium',
          assignee: assigneeEl ? assigneeEl.innerText.trim() : 'Unassigned',
          reporter: reporterEl ? reporterEl.innerText.trim() : 'N/A',
          sprint: '',
          storyPoints: null,
          labels: [],
          components: [],
          comments: domComments,
          source: 'DOM_SCRAPE'
        };
      }

      return restData;
    }, key);

    // Kiểm tra tính hợp lệ của dữ liệu trước khi lưu
    if (!ticketData.summary && !ticketData.description) {
      console.error('\n❌ \x1b[31mCẢNH BÁO: Không tìm thấy Tiêu đề và Mô tả của Ticket!\x1b[0m');
      console.error('Trang có thể chưa nạp xong hoặc quyền truy cập bị hạn chế. Script sẽ KHÔNG ghi đè file rỗng.\n');

      // 🔍 Lưu dữ liệu chẩn đoán để biết trang thực tế đang hiển thị gì
      try {
        const debug = await page.evaluate(() => ({
          title: document.title,
          url: window.location.href,
          bodySnippet: (document.body?.innerText || '').slice(0, 1500),
          hasSummaryVal: !!document.querySelector('#summary-val'),
          hasKeyVal: !!document.querySelector('#key-val'),
          h1Text: document.querySelector('h1')?.innerText?.slice(0, 200) || '',
          detectedFrameworks: {
            classicJira: !!document.querySelector('#jira'),
            cloudSpa: !!document.querySelector('#jira-frontend, [data-testid]')
          }
        }));
        const screenshotPath = path.join(TICKETS_DIR, `${key}.debug.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        const debugTxtPath = path.join(TICKETS_DIR, `${key}.debug.txt`);
        fs.writeFileSync(debugTxtPath,
          `URL: ${debug.url}\nTITLE: ${debug.title}\nH1: ${debug.h1Text}\n` +
          `hasSummaryVal: ${debug.hasSummaryVal} | hasKeyVal: ${debug.hasKeyVal}\n` +
          `classicJira: ${debug.detectedFrameworks.classicJira} | cloudSpa: ${debug.detectedFrameworks.cloudSpa}\n` +
          `\n----- BODY TEXT (first 1500 chars) -----\n${debug.bodySnippet}\n`, 'utf-8');
        console.error(`🔍 Đã lưu chẩn đoán: ${path.relative(process.cwd(), debugTxtPath)} và ${path.relative(process.cwd(), screenshotPath)}\n`);
      } catch (dbgErr) {
        console.error('⚠️ Không thể lưu dữ liệu chẩn đoán:', dbgErr.message);
      }
      return;
    }

    // Làm sạch HTML tags
    function stripHtml(html) {
      if (!html) return '';
      return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    }
    if (ticketData.description && ticketData.description.includes('<')) {
      ticketData.description = stripHtml(ticketData.description);
    }
    if (ticketData.acceptanceCriteria && ticketData.acceptanceCriteria.includes('<')) {
      ticketData.acceptanceCriteria = stripHtml(ticketData.acceptanceCriteria);
    }
    // Làm sạch nội dung từng comment (giữ author/created nguyên văn, chỉ strip HTML body)
    ticketData.comments = (ticketData.comments || [])
      .map(c => ({
        author: c.author || 'Unknown',
        created: c.created || '',
        body: c.body && c.body.includes('<') ? stripHtml(c.body) : (c.body || '')
      }))
      .filter(c => c.body && c.body.trim());

    ticketData.url = url;
    ticketData.syncedAt = new Date().toISOString();

    // 5. Tải attachment thực (ảnh mockup gốc + file đính kèm, đã lọc icon/avatar)
    console.log('\n🖼️  Đang tải attachment thực (đã lọc icon/avatar/badge)...');
    const TICKET_ASSET_DIR = path.join(TICKETS_DIR, key);
    const ATTACHMENTS_DIR = path.join(TICKET_ASSET_DIR, 'attachments');
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

    let downloadedImages = [];
    let downloadedAttachments = [];

    try {
      const { images, attachments } = await collectAttachmentUrls(page);
      console.log(`   🔎 Tìm thấy ${images.length} ảnh + ${attachments.length} attachment trong Description/AC (sẽ lọc icon/avatar/badge < 50KB).`);

      const allDownloads = await downloadAttachments(browserContext, [...images, ...attachments], ATTACHMENTS_DIR);
      // Phân loại lại: url nằm trong images[] -> ảnh mockup; còn lại -> attachment file
      const imageUrlSet = new Set(images);
      downloadedImages = allDownloads.filter(d => imageUrlSet.has(d.url));
      downloadedAttachments = allDownloads.filter(d => !imageUrlSet.has(d.url));
    } catch (assetErr) {
      console.warn(`   ⚠️  Lỗi khi xử lý ảnh/attachment (bỏ qua, không ảnh hưởng dữ liệu ticket): ${assetErr.message}`);
    }

    ticketData.assets = {
      images: downloadedImages.map(d => ({ filename: d.filename, url: d.url, relativePath: `./${key}/attachments/${d.filename}` })),
      attachments: downloadedAttachments.map(d => ({ filename: d.filename, url: d.url, relativePath: `./${key}/attachments/${d.filename}` }))
    };

    // Xây dựng khối Markdown nhúng ảnh (chỉ các mockup/attachment thực sự "nặng" đã qua lọc icon/avatar).
    let mediaSection = '';
    if (ticketData.assets.images.length || ticketData.assets.attachments.length) {
      mediaSection += `---\n\n## 🖼️ Attachments & Screenshots (Tự động thu thập)\n\n`;
      if (ticketData.assets.images.length) {
        mediaSection += `### Ảnh mockup/diagram đính kèm trong Description/AC (đã lọc icon/avatar < 50KB)\n\n`;
        ticketData.assets.images.forEach(img => {
          mediaSection += `![mockup](${img.relativePath})\n\n`;
        });
      }
      if (ticketData.assets.attachments.length) {
        mediaSection += `### File đính kèm khác\n\n`;
        ticketData.assets.attachments.forEach(att => {
          mediaSection += `- [${att.filename}](${att.relativePath})\n`;
        });
        mediaSection += '\n';
      }
    }

    // Comments & Discussion — nguồn Resolution Authority: khi PO/Dev đã chốt cách xử lý
    // mâu thuẫn nghiệp vụ (vd 1 task vs 2 task trong KFWT-1161) trực tiếp trong Jira Comments,
    // /analyze-story và /new-test phải coi khối này là thoả thuận mới nhất, ưu tiên hơn Description/AC gốc.
    let commentsSection = '';
    if (ticketData.comments && ticketData.comments.length) {
      commentsSection = `---\n\n## 💬 Jira Comments & Discussion\n\n` +
        ticketData.comments.map((c, i) => {
          const dateStr = c.created ? new Date(c.created).toLocaleString('vi-VN') : 'N/A';
          return `**#${i + 1} — ${c.author}** _(${dateStr})_\n\n${c.body}\n`;
        }).join('\n---\n\n') + '\n\n';
    }

    // Định dạng Markdown
    const mdContent = `# [${ticketData.key}] ${ticketData.summary || 'Untitled Jira Ticket'}\n\n` +
      `| Thuộc tính | Giá trị |\n` +
      `| :--- | :--- |\n` +
      `| **Key** | \`${ticketData.key}\` |\n` +
      `| **Loại (Issue Type)** | ${ticketData.issueType} |\n` +
      `| **Trạng thái (Status)** | \`${ticketData.status}\` |\n` +
      `| **Độ ưu tiên (Priority)** | ${ticketData.priority} |\n` +
      `| **Người thực hiện (Assignee)** | ${ticketData.assignee} |\n` +
      `| **Người tạo (Reporter)** | ${ticketData.reporter} |\n` +
      `| **Sprint** | ${ticketData.sprint || 'Grids Ampere 26-17'} |\n` +
      `| **Story Points** | ${ticketData.storyPoints !== null && ticketData.storyPoints !== undefined ? ticketData.storyPoints : 'N/A'} |\n` +
      `| **Jira URL** | [${ticketData.url}](${ticketData.url}) |\n` +
      `| **Synced At** | \`${ticketData.syncedAt}\` |\n\n` +
      `---\n\n` +
      `## 📝 Description\n\n${ticketData.description || '*(No description provided)*'}\n\n` +
      `---\n\n` +
      `## 🎯 Acceptance Criteria (AC)\n\n${ticketData.acceptanceCriteria || '*(See description above)*'}\n\n` +
      mediaSection +
      commentsSection +
      `---\n\n` +
      `## 🤖 Copilot Automation Context\n` +
      `- **Target Spec Path**: \`tests/e2e/TC-${ticketData.key}.spec.ts\`\n` +
      `- **Test Plan Path**: \`tests/testcases/TC-${ticketData.key}.md\`\n` +
      `- **Related Confluence Docs**: Check \`docs/specs/index.yaml\`\n`;

    ticketData.markdown = mdContent;

    // Ghi file
    const mdPath = path.join(TICKETS_DIR, `${key}.md`);
    const jsonPath = path.join(TICKETS_DIR, `${key}.json`);

    fs.writeFileSync(mdPath, mdContent, 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify(ticketData, null, 2), 'utf-8');

    console.log(`\n🎉 \x1b[32mBÓC TÁCH THÀNH CÔNG TICKET ${key}!\x1b[0m`);
    console.log(`📄 Markdown: \x1b[36m${path.relative(process.cwd(), mdPath)}\x1b[0m`);
    console.log(`📦 JSON:     \x1b[36m${path.relative(process.cwd(), jsonPath)}\x1b[0m`);
    console.log(`📌 Nguồn:    \x1b[33m${ticketData.source}\x1b[0m`);
    console.log(`🏷️  Tiêu đề:  \x1b[1m${ticketData.summary}\x1b[0m`);
    console.log(`🖼️  Ảnh mockup: \x1b[36m${downloadedImages.length}\x1b[0m | 📎 Attachment: \x1b[36m${downloadedAttachments.length}\x1b[0m`);
    console.log(`📂 Assets:   \x1b[36m${path.relative(process.cwd(), TICKET_ASSET_DIR)}\x1b[0m\n`);

  } catch (err) {
    console.error(`\n❌ Lỗi:`, err.message);
  } finally {
    if (!isCdp) {
      // Đợi 2s để người dùng kịp nhìn thấy trang trước khi đóng
      await page.waitForTimeout(2000);
      await page.close().catch(() => {});
      await browserContext.close().catch(() => {});
    } else {
      await page.close().catch(() => {});
    }
  }
}

const targetArg = process.argv[2];
if (!targetArg) {
  console.log('⚡ Usage: node scripts/fetch-jira.js <KEY_OR_URL>');
  console.log('   Ví dụ: node scripts/fetch-jira.js KFWT-1161');
  process.exit(1);
}

fetchJiraTicket(targetArg);
