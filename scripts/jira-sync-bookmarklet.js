(async function() {
  const RETROFIT_API = 'http://127.0.0.1:3001/api/save-ticket';
  const BOLT_API = 'http://158.178.226.22:8000/api/webhook/jira';

  function showToast(msg, isSuccess = true, subMsg = '') {
    const id = '__jira_retrofit_sync_toast';
    let el = document.getElementById(id);
    if (el) el.remove();

    el = document.createElement('div');
    el.id = id;
    el.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: #0d1117;
      color: #f0f6fc;
      border: 1px solid ${isSuccess ? '#238636' : '#da3633'};
      border-left: 5px solid ${isSuccess ? '#2ea043' : '#f85149'};
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 12px 28px rgba(0,0,0,0.45);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      max-width: 420px;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    el.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 10px;">
        <span style="font-size: 18px;">${isSuccess ? '⚡' : '⚠️'}</span>
        <div style="flex: 1;">
          <strong style="color: ${isSuccess ? '#56d364' : '#ff7b72'}; font-size: 14px; display: block; margin-bottom: 4px;">
            ${msg}
          </strong>
          ${subMsg ? `<div style="color: #8b949e; font-size: 12px;">${subMsg}</div>` : ''}
        </div>
        <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: #8b949e; cursor: pointer; font-size: 16px; padding: 0 4px;">×</button>
      </div>
    `;

    document.body.appendChild(el);
    setTimeout(() => { if (el && el.parentElement) el.remove(); }, 7000);
  }

  // 1. Extract Ticket Key
  const match = window.location.pathname.match(/\/browse\/([A-Z0-9]+-\d+)/i) || 
                document.title.match(/\[([A-Z0-9]+-\d+)\]/i);
  if (!match) {
    showToast('Không tìm thấy Jira Ticket Key!', false, 'Hãy chắc chắn bạn đang mở trang Jira Ticket (ví dụ /browse/KFWT-1161)');
    return;
  }
  const ticketKey = match[1].toUpperCase();
  showToast(`Đang trích xuất dữ liệu ${ticketKey}...`, true, 'Đang đọc từ Jira REST API & DOM');

  let data = {
    key: ticketKey,
    summary: '',
    description: '',
    acceptanceCriteria: '',
    issueType: 'Story',
    status: 'To Do',
    priority: 'Medium',
    assignee: 'Unassigned',
    reporter: 'N/A',
    sprint: '',
    storyPoints: null,
    url: window.location.href,
    labels: [],
    components: [],
    comments: []
  };

  // Helper: chuẩn hoá 1 comment REST API (Jira Server/DC v2) hoặc ADF-rendered thành object sạch
  function normalizeRestComment(c) {
    const rawBody = (c.renderedBody || c.body || '').toString();
    return {
      author: (c.updateAuthor && c.updateAuthor.displayName) || (c.author && c.author.displayName) || 'Unknown',
      created: c.created || c.updated || '',
      body: rawBody
    };
  }

  // 2. Try Fetching via Jira Internal REST API (Cookie Auth)
  let restSuccess = false;
  try {
    const res = await fetch(`/rest/api/2/issue/${ticketKey}?expand=renderedFields,names&fields=*all,comment`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) {
      const issue = await res.json();
      const fields = issue.fields || {};
      const rendered = issue.renderedFields || {};
      const names = issue.names || {};

      // Trích xuất Comments (fields.comment.comments) — nguồn "Resolution Authority" khi PO/Dev
      // đã chốt phương án xử lý mâu thuẫn nghiệp vụ trực tiếp trong Jira Comments.
      const restComments = (fields.comment && Array.isArray(fields.comment.comments)) ? fields.comment.comments : [];
      const renderedComments = (rendered.comment && Array.isArray(rendered.comment.comments)) ? rendered.comment.comments : [];
      if (restComments.length) {
        data.comments = restComments.map((c, idx) => {
          const renderedMatch = renderedComments[idx] || {};
          return normalizeRestComment({ ...c, renderedBody: renderedMatch.body || c.body });
        });
      }

      data.summary = fields.summary || '';
      data.description = rendered.description || fields.description || '';
      data.issueType = fields.issuetype ? fields.issuetype.name : 'Story';
      data.status = fields.status ? fields.status.name : 'To Do';
      data.priority = fields.priority ? fields.priority.name : 'Medium';
      data.assignee = fields.assignee ? fields.assignee.displayName : 'Unassigned';
      data.reporter = fields.reporter ? fields.reporter.displayName : 'N/A';
      data.labels = fields.labels || [];
      data.components = (fields.components || []).map(c => c.name);

      // Search customfields for Story Points, Sprint, AC
      for (const [cfKey, cfLabel] of Object.entries(names)) {
        const lbl = cfLabel.toLowerCase();
        if (lbl.includes('point') && fields[cfKey] !== undefined) {
          data.storyPoints = fields[cfKey];
        }
        if ((lbl.includes('acceptance') || lbl.includes('criteria') || lbl.includes('tiêu chí')) && fields[cfKey]) {
          data.acceptanceCriteria = rendered[cfKey] || fields[cfKey];
        }
        if (lbl.includes('sprint') && fields[cfKey]) {
          const spVal = fields[cfKey];
          if (Array.isArray(spVal) && spVal.length) {
            const last = spVal[spVal.length - 1];
            data.sprint = typeof last === 'string' ? (last.match(/name=([^,\]]+)/) || [,''])[1] : (last.name || '');
          } else if (typeof spVal === 'string') {
            data.sprint = (spVal.match(/name=([^,\]]+)/) || [,''])[1] || spVal;
          }
        }
      }
      restSuccess = true;
    }
  } catch (err) {
    console.warn('[Sync to Retrofit] Jira REST API failed, using DOM fallback', err);
  }

  // 3. Fallback to DOM Scraping if needed
  if (!restSuccess || !data.summary) {
    const summaryEl = document.querySelector('#summary-val') || 
                      document.querySelector('h1[data-test-id="issue.views.issue-base.foundation.summary.heading"]') || 
                      document.querySelector('h1');
    if (summaryEl) data.summary = summaryEl.innerText.trim();

    const descEl = document.querySelector('#description-val') || 
                   document.querySelector('[data-test-id="issue.views.field.rich-text.description"]') || 
                   document.querySelector('#descriptionmodule .user-content-block');
    if (descEl) data.description = descEl.innerText.trim();

    const statusEl = document.querySelector('#status-val') || document.querySelector('.jira-issue-status-lozenge');
    if (statusEl) data.status = statusEl.innerText.trim();

    const typeEl = document.querySelector('#type-val');
    if (typeEl) data.issueType = typeEl.innerText.trim();

    const priorityEl = document.querySelector('#priority-val');
    if (priorityEl) data.priority = priorityEl.innerText.trim();

    const assigneeEl = document.querySelector('#assignee-val');
    if (assigneeEl) data.assignee = assigneeEl.innerText.trim();

    const reporterEl = document.querySelector('#reporter-val');
    if (reporterEl) data.reporter = reporterEl.innerText.trim();
  }

  // 3b. DOM fallback cho Comments nếu REST API chưa trả về (vd Jira Cloud custom permission)
  if (!data.comments.length) {
    const commentNodes = document.querySelectorAll('.activity-comment, div[id^="comment-"]');
    commentNodes.forEach(node => {
      const authorEl = node.querySelector('.action-details .user-hover, .action-head .user-hover, a.user-hover, .twixi-name');
      const dateEl = node.querySelector('.action-details time, .date, time');
      const bodyEl = node.querySelector('.action-body, .comment-body, .twixi-wrap .action-body');
      const body = bodyEl ? bodyEl.innerHTML : '';
      if (!body) return;
      data.comments.push({
        author: authorEl ? authorEl.innerText.trim() : 'Unknown',
        created: dateEl ? (dateEl.getAttribute('datetime') || dateEl.innerText.trim()) : '',
        body
      });
    });
  }

  // Clean html tags from description if needed
  function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.innerText || tmp.textContent || '';
  }
  if (data.description && data.description.includes('<')) {
    data.description = stripHtml(data.description);
  }
  if (data.acceptanceCriteria && data.acceptanceCriteria.includes('<')) {
    data.acceptanceCriteria = stripHtml(data.acceptanceCriteria);
  }
  // Làm sạch nội dung từng comment (giữ author/created nguyên văn, chỉ strip HTML body)
  data.comments = (data.comments || [])
    .map(c => ({
      author: c.author || 'Unknown',
      created: c.created || '',
      body: c.body && c.body.includes('<') ? stripHtml(c.body) : (c.body || '')
    }))
    .filter(c => c.body && c.body.trim());

  // 4b. Format khối Comments & Discussion — nguồn Resolution Authority khi PO/Dev đã chốt
  // mâu thuẫn nghiệp vụ (vd 1 task vs 2 task) trực tiếp trong Jira Comments.
  let commentsSection = '';
  if (data.comments.length) {
    commentsSection = `---\n\n## 💬 Jira Comments & Discussion\n\n` +
      data.comments.map((c, i) => {
        const dateStr = c.created ? new Date(c.created).toLocaleString('vi-VN') : 'N/A';
        return `**#${i + 1} — ${c.author}** _(${dateStr})_\n\n${c.body}\n`;
      }).join('\n---\n\n') + '\n\n';
  }

  // 4. Format Markdown
  const mdContent = `# [${data.key}] ${data.summary || 'Untitled Jira Ticket'}\n\n` +
    `| Thuộc tính | Giá trị |\n` +
    `| :--- | :--- |\n` +
    `| **Key** | \`${data.key}\` |\n` +
    `| **Loại (Issue Type)** | ${data.issueType} |\n` +
    `| **Trạng thái (Status)** | \`${data.status}\` |\n` +
    `| **Độ ưu tiên (Priority)** | ${data.priority} |\n` +
    `| **Người thực hiện (Assignee)** | ${data.assignee} |\n` +
    `| **Người tạo (Reporter)** | ${data.reporter} |\n` +
    `| **Sprint** | ${data.sprint || 'Grids Ampere 26-17'} |\n` +
    `| **Story Points** | ${data.storyPoints !== null && data.storyPoints !== undefined ? data.storyPoints : 'N/A'} |\n` +
    `| **Jira URL** | [${data.url}](${data.url}) |\n` +
    `| **Synced At** | \`${new Date().toISOString()}\` |\n\n` +
    `---\n\n` +
    `## 📝 Description\n\n${data.description || '*(No description provided)*'}\n\n` +
    `---\n\n` +
    `## 🎯 Acceptance Criteria (AC)\n\n${data.acceptanceCriteria || '*(See description above)*'}\n\n` +
    (commentsSection || `---\n\n`) +
    `## 🤖 Copilot Automation Context\n` +
    `- **Target Spec Path**: \`tests/e2e/TC-${data.key}.spec.ts\`\n` +
    `- **Test Plan Path**: \`tests/testcases/TC-${data.key}.md\`\n` +
    `- **Related Confluence Docs**: Check \`docs/specs/index.yaml\`\n`;

  data.markdown = mdContent;

  // 5. Send POST to Local Retrofit Server
  let localSaved = false;
  try {
    const postRes = await fetch(RETROFIT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (postRes.ok) {
      localSaved = true;
      const resJson = await postRes.json();
      showToast(
        `✅ Đã lưu ${data.key} vào Retrofit!`,
        true,
        `File: <b>${resJson.file}</b><br>Copilot sẵn sàng generate Playwright test spec.`
      );
    }
  } catch (netErr) {
    console.warn('[Sync to Retrofit] Local server unreachable:', netErr);
  }

  // 6. Optional: Dual Sync to BOLT Orchestrator VPS
  try {
    fetch(BOLT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: data.key,
        summary: data.summary,
        description: data.description,
        status: data.status,
        assignee: data.assignee,
        reporter: data.reporter,
        story_points: data.storyPoints,
        sprint: data.sprint,
        url: data.url
      })
    }).catch(() => {});
  } catch (_) {}

  // 7. Fallback if local server wasn't running
  if (!localSaved) {
    try {
      await navigator.clipboard.writeText(mdContent);
      // Also trigger download
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${data.key}.md`;
      a.click();

      showToast(
        `⚠️ Đã tải ${data.key}.md & Copy Clipboard!`,
        false,
        'Server port 3001 chưa bật. File đã được tải về máy và copy vào clipboard để dán vào docs/tickets/.'
      );
    } catch (clipErr) {
      showToast('❌ Không thể lưu vào port 3001', false, 'Hãy chạy: node demo-server.js trong QA-Playwright-KFWT-Retrofit');
    }
  }
})();