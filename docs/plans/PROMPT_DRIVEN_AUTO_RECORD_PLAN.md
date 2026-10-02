# 🤖🎬 Implementation Plan: Prompt-Driven Auto-Record (`record:agent`)

> **Ý tưởng của Sếp:** *"Có cách nào chạy kết hợp prompt và record không? Tester chạy prompt 1 lần → AI tự điều khiển browser → hệ thống tự intercept & ghi lại các thao tác thành công → tự sinh `recording.ts` → tự `sync-specs` ra POM + Spec. Lần sau chạy hồi quy chỉ cần `npm run test:function <KEY>` (0 token, siêu tốc, CI/CD)."*

> **Phạm vi tài liệu:** Phân tích kiến trúc kỹ thuật (cơ chế intercept action của Agent, bóc selector sạch, pipeline nối sang `sync-specs`) và Implementation Plan chi tiết từng bước để triển khai vào `QA-Playwright-ASAP`.

---

## 0. TL;DR cho Sếp

1. **Ý tưởng khả thi 100%** và tái dùng được ~80% hạ tầng đã có. Không cần viết lại từ đầu, chỉ cần **tách 1 nhánh mới `record:agent`** và **nối lại đường ống hiện hữu**.
2. **Tách bạch rõ 2 tính năng (đúng yêu cầu Sếp):**
   - **Luồng 1 — Manual Record (giữ nguyên):** `npm run record:function` / `record:ticket` → Tester tự click tay → `record-ticket.js` dùng `context._enableRecorder()` ghi lại.
   - **Luồng 2 — Prompt-driven Auto-Record (MỚI):** `npm run record:agent <KEY>` → Tester đưa prompt → AI điều khiển browser → **Instrumented Executor** intercept mọi action **thành công** → xuất `recording.ts` → tự chạy `sync-specs` → POM + Spec.
3. **Quyết định kiến trúc then chốt (khác với trực giác ban đầu):** **KHÔNG** dùng `_enableRecorder()` để "nghe lén" action của AI. Lý do kỹ thuật: recorder của Playwright chỉ bắt **cử chỉ người thật (trusted input)**; action do Playwright API (`locator.click/fill`) phát ra **không được recorder ghi lại ổn định**. Thay vào đó dùng mô hình **Action-Interceptor / Page Proxy**: orchestrator tự sinh dòng code recording **ngay tại thời điểm locator chạy thành công**. Cách này còn **tốt hơn** codegen vì ta ghi đúng *selector sạch đã resolve thành công*, không dính rác `ui-state-hover`.
4. **Pipeline đích đã có sẵn:** chỉ cần `recording.ts` đúng format codegen là `scripts/sync-specs.js <KEY>` tự lo POM + Spec. **Mối hàn còn thiếu = bước sinh `recording.ts` từ AI.**
5. **Chi phí token:** chỉ tốn 1 lần lúc `record:agent`. Về sau `test:function` = 0 token.

---

## 1. Hiện trạng codebase (đã khảo sát)

| Thành phần | File | Vai trò hiện tại | Tái dùng cho Luồng 2? |
| :-- | :-- | :-- | :-- |
| Manual recorder | `scripts/record-ticket.js` | `context._enableRecorder()` (API codegen nội bộ) + Layer 1 DOM Annotator + Layer 2 PrimeFaces Bridge, xuất `tests/recordings/functions/<KEY>.recording.ts` | ♻️ Mượn init-scripts (annotator/bridge) + logic resolve viewport/auth |
| Agent runner | `scripts/run-agent.js` | Mode 2: mở Chromium headed, nạp POM đã kiểm chứng, chạy step cứng + AI Rescue (snapshot UI → hỏi AI → `executeAiAction`) | ♻️ **Lõi tái dùng cao nhất**: `collectInteractiveElements`, `parseAiActionJson`, `executeAiAction`, CDP maximize, SSO hand-off, `cli-runner` |
| CLI bridge | `scripts/lib/cli-runner.js` | Gọi Copilot/Claude CLI có timeout, kill cây tiến trình, stream log | ♻️ Dùng nguyên |
| Reverse-grounding + sinh POM/Spec | `scripts/sync-specs.js` | Bóc `recording.ts` → POM TS (`extractPomModel`) + starter spec + merge `live_grounded_components.yaml` | ♻️ **Đích của pipeline** — gọi qua `spawnSync` |
| Native runner | `scripts/run-function.js` | `npm run test:function <KEY>` chạy spec Playwright (0 token) | ✅ Đích hồi quy cuối |

**Kết luận:** Luồng 2 = *ghép* `run-agent.js` (điều khiển AI) **×** `record-ticket.js` (ghi file) **×** `sync-specs.js` (đóng gói). Ta viết **1 script mới `scripts/record-agent.js`** làm nhạc trưởng, cộng **1 module interceptor** tách riêng để test độc lập.

---

## 2. Phân tích kiến trúc kỹ thuật

### 2.1. Vì sao KHÔNG "nghe lén" bằng `_enableRecorder()` (bác bỏ phương án trực giác)

`context._enableRecorder({ mode: 'recording' })` hoạt động bằng cách **inject content-script lắng nghe sự kiện DOM do người dùng thật gây ra** (`isTrusted` pointer/keyboard). Khi **AI điều khiển** qua Playwright API (`locator.click()`), action đi xuống qua CDP `Input.dispatch*` theo cơ chế riêng và **recorder không bảo đảm bắt được** (Playwright chủ động không "double-record" action của chính nó). Hệ quả nếu dùng cách này: file recording **thiếu bước / lệch frame / rác không kiểm soát** — đúng các bệnh đã thấy ở Layer 2 Bridge.

→ **Loại bỏ.** Không phụ thuộc hành vi private không ổn định.

### 2.2. Phương án chọn: **Instrumented Executor (Action-Interceptor / Page Proxy)**

Tư tưởng: **chính orchestrator là người thực thi action**, nên nó **biết chắc** locator nào vừa chạy xong. Ta "chèn" (intercept) một bước ghi log **ngay sau khi action thành công**:

```
AI đề xuất action (JSON)  ─►  Resolver dựng Playwright locator sạch
                               │
                               ├─ thực thi (click/fill/select/goto)
                               │        │ thành công?
                               │        ├─ CÓ ─► RecordingTape.push(dòng code codegen-chuẩn)
                               │        └─ KHÔNG ─► thử chiến lược locator khác / báo AI
                               ▼
                         UI snapshot kế tiếp  ─►  vòng lặp
```

Khác biệt cốt lõi so với codegen: ta ghi **locator-expression mà ta chủ động dựng và đã verify visible+actionable**, nên:
- **Selector sạch có kiểm soát** (ưu tiên `getByRole`/`getByLabel`/`[id=...]`, loại `ui-state-hover/active/focus`).
- **Chỉ ghi action THÀNH CÔNG** (đúng yêu cầu Sếp) — action fail/thử lại không lọt vào file.
- **Idempotent frame-aware**: ta biết đang ở `page` hay trong `iframe[title="Task frame"]` nên sinh đúng chuỗi `.contentFrame()`.

### 2.3. "Page Proxy" — cách gài interceptor không rải rác

Để tránh nhét `tape.push()` thủ công khắp nơi, bọc `page` và `frameLocator` bằng **Proxy** mỏng, hoặc gọn hơn: tập trung mọi thao tác qua **1 hàm `performAndRecord(step)`** duy nhất. Khuyến nghị dùng **hàm tập trung** (`ActionExecutor.perform`) thay vì `Proxy` ES — dễ đọc, dễ test, khớp phong cách `executeAiAction` sẵn có.

```js
// scripts/lib/recording-tape.js  (module mới, pure, unit-test được)
class RecordingTape {
  constructor() { this.lines = []; }
  goto(url)            { this.lines.push(`  await page.goto(${q(url)});`); }
  action(step)         { this.lines.push(serializeStep(step)); } // → dòng codegen-chuẩn
  toSource(meta)       { return HEADER(meta) + this.lines.join('\n') + FOOTER; }
}
```

`serializeStep` dựng đúng format đang có trong `CREATE_RISK_REQUEST.recording.ts`:

```ts
await page.locator('iframe[title="Task frame"]').contentFrame()
  .getByRole('textbox', { name: 'Risk Title' }).fill('vnchap22');
```

### 2.4. Bóc tách selector sạch (Clean Selector Strategy)

Resolver nhận "ý định" từ AI (`{ action, target, value }`) và **thử theo thứ tự ưu tiên selector ổn định**, locator nào chạy được thì **chính nó** được serialize vào tape (nguồn chân lý = cái vừa chạy):

| Ưu tiên | Chiến lược | Dòng ghi vào recording |
| :-- | :-- | :-- |
| 1 | `getByRole(role, { name, exact })` | `.getByRole('button', { name: 'Next' })` |
| 2 | `getByLabel` / `getByPlaceholder` | `.getByLabel('Application name')` |
| 3 | `[id="..."]` PrimeFaces ổn định (bỏ phần `:j_id` động nếu có) | `.locator('[id="riskDescriptionForm:applicationDefined"]')` |
| 4 | `getByText(text, { exact })` | `.getByText('Please select control(s)')` |
| 5 | CSS tối giản đã **strip** `ui-state-(hover\|active\|focus)` | `.locator('.ui-chkbox-box')` |

Guardrail sạch:
- **Strip transient class** bằng regex `\.ui-state-(hover|focus|active)\b` (đã có tiền lệ trong `sync-specs.js`).
- **Chuẩn hoá frame**: nếu element nằm trong task frame → luôn prefix `page.locator('iframe[title="Task frame"]').contentFrame()`.
- **Hạ `dblclick`→`click`** (khớp luật `extractPomModel` đang có) để POM/Spec ổn định.
- **Bỏ `page.goto` tới URL ephemeral** `/faces/instances/...` (đã có logic trong `sync-specs.js` + `extractEntryUrl`), chỉ giữ entry URL sạch (ưu tiên `process.env.BASE_URL`).

### 2.5. Vai trò `CDPSession`

`CDPSession` **không** dùng để intercept action (đã chọn Instrumented Executor). Nó giữ 3 vai trò phụ, tái dùng từ `run-agent.js`:
- **Maximize cửa sổ** (`Browser.getWindowForTarget` + `Browser.setWindowBounds`).
- **(Tuỳ chọn) ổn định tốc độ**: `Page.navigate`/`Network.enable` để chờ idle chắc chắn trên PrimeFaces AJAX.
- **(Tuỳ chọn nâng cao)** `Input.insertText` cho field khó — không bắt buộc ở MVP.

### 2.6. Pipeline tự động nối sang `sync-specs`

Sau khi tape ghi xong file `tests/recordings/functions/<KEY>.recording.ts`, orchestrator **tự gọi**:

```js
spawnSync(process.execPath, ['scripts/sync-specs.js', key, '--force-pom', '--force-spec'],
          { stdio: 'inherit', cwd: ROOT_DIR });
```

`sync-specs.js` (đã có) tự sinh:
- `tests/pages/functions/<PascalCase>Page.ts` (POM)
- `tests/e2e/functions/TC-<KEY>.spec.ts` (starter spec)
- merge `docs/specs/codebase/live_grounded_components.yaml` (reverse-grounding)

→ Hồi quy: `npm run test:function <KEY>` (0 token).

### 2.7. Sơ đồ luồng tổng thể (Luồng 2)

```
npm run record:agent <KEY> [--prompt-file f.md | --prompt "text"]
        │
        ▼
record-agent.js
  1. Load prompt (file/text) + (tuỳ chọn) testcase/recording ground-truth
  2. Launch Chromium --headed + storageState(.auth) + initScripts(annotator,bridge)
  3. CDP maximize; goto BASE_URL; SSO hand-off nếu cần
  4. ┌─ LOOP (Perceive → Plan → Act → Record) ─────────────┐
     │  a. Snapshot UI (collectInteractiveElements + URL)   │
     │  b. Hỏi AI (cli-runner) → JSON next-action           │
     │  c. Resolver dựng locator sạch theo ưu tiên          │
     │  d. Execute; nếu OK → RecordingTape.action(step)     │
     │  e. AI trả {"action":"done"} hoặc đạt max-steps → out│
     └──────────────────────────────────────────────────────┘
  5. tape.toSource() → ghi tests/recordings/functions/<KEY>.recording.ts
  6. spawnSync sync-specs.js <KEY> --force-pom --force-spec
  7. (tuỳ chọn) chạy thử npm run test:function <KEY> để xác nhận GREEN
        │
        ▼
POM + Spec sẵn sàng  ──►  Hồi quy CI/CD: npm run test:function <KEY>  (0 token)
```

---

## 3. Implementation Plan — từng bước

### Phase 0 — Chuẩn bị & tách lõi dùng chung (không đổi hành vi hiện tại)
- **0.1** Trích các helper từ `run-agent.js` ra module tái dùng `scripts/lib/agent-dom.js`:
  `collectInteractiveElements`, `parseAiActionJson`, `isSsoUrl`, `resolveBinary`, SSO hand-off, CDP maximize.
  *Giữ `run-agent.js` import lại từ module này — refactor thuần, không đổi output.*
- **0.2** Trích init-scripts (`IFRAME_SCROLL_FIX_SCRIPT`, `PF_DROPDOWN_BRIDGE_SCRIPT`, DOM Annotator) từ `record-ticket.js` ra `scripts/lib/record-init-scripts.js` để cả 2 luồng dùng chung.
- **Deliverable:** 2 module mới; `npm run record:function` và `npm run test:agent` vẫn chạy y hệt (regression check).

### Phase 1 — Module ghi băng (pure, test-first)
- **1.1** Tạo `scripts/lib/recording-tape.js` (class `RecordingTape` + `serializeStep` + `cleanLocatorExpr` + `HEADER/FOOTER`).
- **1.2** `serializeStep` hỗ trợ action: `goto, click, fill, selectOption, check, press`. Frame-aware (`inFrame: boolean`, `frameSelector`).
- **1.3** Header phải **byte-tương thích** với format codegen hiện tại (so khớp `CREATE_RISK_REQUEST.recording.ts`): `test.use({...storageState, viewport...})` + `test('test', async ({ page }) => {`.
- **1.4** Unit test `tests/unit/recording-tape.test.ts` (hoặc node script) so output với 1 recording mẫu → `sync-specs.js` phải parse ra POM không lỗi.
- **Deliverable:** cho 1 mảng step mẫu → sinh ra file mà `sync-specs.js` đọc được.

### Phase 2 — Action Resolver & Executor (bóc selector sạch)
- **2.1** Tạo `scripts/lib/action-executor.js`: `async perform(scope, page, step, tape)`:
  - Dựng danh sách candidate locator theo thứ tự ưu tiên (Mục 2.4).
  - `waitFor({state:'visible'})` + actionability; locator đầu tiên chạy được → thực thi.
  - **Chỉ khi thành công** mới gọi `tape.action(serializableStep)` với locator-expr đúng đã dùng.
  - Trả `{ ok, usedLocatorExpr, error }`.
- **2.2** Chuẩn hoá frame: tự phát hiện scope là task-frame hay page để prefix `.contentFrame()`.
- **2.3** Áp guardrail sạch: strip `ui-state-*`, hạ `dblclick→click`, bỏ goto ephemeral.
- **2.4** Chờ PrimeFaces AJAX idle giữa các action (tái dùng `waitAjaxIdle` từ `run-agent.js`).
- **Deliverable:** executor độc lập, có test giả lập 1 page tĩnh (hoặc dùng app thật thủ công).

### Phase 3 — Orchestrator `record-agent.js` (nhạc trưởng Luồng 2)
- **3.1** Tạo `scripts/record-agent.js`. CLI:
  `node scripts/record-agent.js <KEY> [--prompt-file <path> | --prompt "<text>"] [--cli copilot|claude] [--slowmo 400] [--max-steps 60] [--no-sync] [--run]`
- **3.2** Load prompt: ưu tiên `--prompt-file`, rồi `--prompt`, rồi fallback `docs/tester-prompts/*.prompt.md` hoặc `tests/testcases/functions/TC-<KEY>.md` nếu có (ground-truth).
- **3.3** Launch headed + initScripts (Phase 0.2) + auth + CDP maximize + SSO hand-off.
- **3.4** `tape.goto(cleanEntryUrl)` cho bước mở Portal.
- **3.5** Vòng lặp **Perceive→Plan→Act→Record** (Mục 2.7 b–e):
  - Prompt gửi AI gồm: mục tiêu tổng (prompt gốc) + lịch sử step đã làm + UI snapshot hiện tại + **yêu cầu trả DUY NHẤT 1 JSON** `{"action":"click|fill|selectOption|press|done","target":"...","value":"..."}`.
  - Parse bằng `parseAiActionJson` (đã có). `action:"done"` → kết thúc.
  - Gọi `ActionExecutor.perform`; thất bại → đưa lỗi + snapshot mới vào vòng kế để AI thử lại (tối đa N lần/step).
  - Guard: `--max-steps` (mặc định 60) chống loop vô hạn & cháy token.
- **3.6** Kết thúc: `fs.writeFileSync(recordingPath, tape.toSource(meta))`.
- **3.7** Nếu không `--no-sync`: `spawnSync('scripts/sync-specs.js', [key,'--force-pom','--force-spec'])`.
- **3.8** Nếu `--run`: `spawnSync('scripts/run-function.js', [key])` để xác nhận GREEN ngay.
- **3.9** Log phiên vào `logs/agent-runs/record-agent-<KEY>-<ts>.log` (tái dùng pattern có sẵn).
- **Deliverable:** 1 lệnh chạy end-to-end ra đủ recording + POM + spec.

### Phase 4 — Tích hợp npm scripts & tách bạch 2 luồng
- **4.1** Thêm vào `package.json`:
  ```json
  "record:agent": "node scripts/record-agent.js",
  "record:agent:function": "node scripts/record-agent.js"
  ```
  Giữ nguyên `record:function`, `record:ticket`, `test:function`, `test:agent` (không đụng).
- **4.2** Bảng phân vai rõ ràng (đưa vào README):

  | Lệnh | Luồng | Ai điều khiển chuột? | Token | Output |
  | :-- | :-- | :-- | :-- | :-- |
  | `npm run record:function <KEY>` | 1 — Manual | **Tester (tay)** | 0 | recording→POM→spec |
  | `npm run record:agent <KEY>` | 2 — Auto | **AI Agent** | 1 lần | recording→POM→spec |
  | `npm run test:function <KEY>` | Hồi quy | Không (native) | 0 | pass/fail CI/CD |

### Phase 5 — Kiểm thử & nghiệm thu
- **5.1** Regression Luồng 1: `record:function` + `test:agent` output không đổi (Phase 0).
- **5.2** E2E Luồng 2 trên `CREATE_RISK_REQUEST`: chạy `record:agent CREATE_RISK_REQUEST --prompt-file docs/tester-prompts/create-risk-request.prompt.md --run` → kỳ vọng sinh recording mới, POM, spec, và `test:function` **GREEN**.
- **5.3** So sánh recording AI-sinh vs recording manual: selector phải *sạch hơn hoặc tương đương* (không `ui-state-hover`), parse `sync-specs` 0 lỗi.
- **5.4** Negative: prompt mơ hồ → AI loop chạm `--max-steps` → thoát an toàn, vẫn ghi phần đã làm, báo cáo trung thực.

### Phase 6 — Tài liệu & rollout
- **6.1** Cập nhật `README.md` + `docs/RUN_AGENT_GUIDE.md`: thêm mục Luồng 2, bảng phân vai.
- **6.2** Ghi chú CI: pipeline CI chỉ chạy `test:function` (0 token); `record:agent` là bước thủ công một lần của Tester.
- **6.3** Changelog `CHANGELOG.md`.

---

## 4. Danh sách file đụng tới

| Hành động | File |
| :-- | :-- |
| **Mới** | `scripts/record-agent.js` (orchestrator Luồng 2) |
| **Mới** | `scripts/lib/recording-tape.js` (ghi băng → recording.ts) |
| **Mới** | `scripts/lib/action-executor.js` (resolve + bóc selector sạch) |
| **Mới** | `scripts/lib/agent-dom.js` (helper tách từ run-agent.js) |
| **Mới** | `scripts/lib/record-init-scripts.js` (init-scripts tách từ record-ticket.js) |
| **Sửa nhẹ** | `scripts/run-agent.js` (import helper từ agent-dom.js — refactor thuần) |
| **Sửa nhẹ** | `scripts/record-ticket.js` (import init-scripts từ module chung) |
| **Sửa** | `package.json` (thêm `record:agent`) |
| **Sửa** | `README.md`, `docs/RUN_AGENT_GUIDE.md`, `CHANGELOG.md` |
| **Không đụng** | `sync-specs.js`, `run-function.js` (đã đủ dùng, chỉ gọi qua spawn) |

---

## 5. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
| :-- | :-- | :-- |
| AI chọn sai selector / loop vô hạn → cháy token | Cao | `--max-steps`, giới hạn retry/step, timeout `cli-runner`, log đầy đủ |
| Recording AI-sinh lệch format → `sync-specs` parse lỗi | Trung | Phase 1 test-first đối chiếu byte format + CI parse-check |
| PrimeFaces AJAX re-render làm locator "biến mất" | Trung | `waitAjaxIdle` giữa action; tái dùng Layer 1 Annotator + Layer 2 Bridge initScripts |
| SSO/MFA chặn phiên | Trung | Tái dùng SSO hand-off 120s + lưu `.auth/user.json` |
| URL ephemeral `/faces/instances/...` gây "View Expired" | Thấp | Chỉ ghi entry URL sạch (`extractEntryUrl` logic) + ưu tiên `BASE_URL` |
| Dữ liệu value do AI bịa cho field (negative test) | Trung | Mặc định tôn trọng prompt; chỉ fill khi prompt/ground-truth chỉ định (kế thừa triết lý Ground-Truth của `run-agent.js`) |

---

## 6. Acceptance Criteria

1. `npm run record:agent CREATE_RISK_REQUEST --prompt-file <prompt>` chạy trọn, không cần Tester click tay.
2. Sinh ra `tests/recordings/functions/CREATE_RISK_REQUEST.recording.ts` **đúng format codegen**, selector không chứa `ui-state-hover/active/focus`.
3. Tự chạy `sync-specs` → có `CreateRiskRequestPage.ts` + `TC-CREATE_RISK_REQUEST.spec.ts`.
4. `npm run test:function CREATE_RISK_REQUEST` **GREEN** (0 token).
5. Luồng 1 (`record:function`) và `test:agent` **không thay đổi hành vi**.
6. Có `--max-steps` và thoát an toàn khi prompt mơ hồ.

---

## 7. Thứ tự triển khai đề xuất (sprint)

1. **Phase 0 + 1** (nền tảng, test-first) — rủi ro thấp, mở khoá mọi thứ sau.
2. **Phase 2 + 3** (lõi AI-drive + ghi băng) — giá trị chính.
3. **Phase 4 + 5** (nối npm + nghiệm thu trên `CREATE_RISK_REQUEST`).
4. **Phase 6** (docs + rollout CI).
