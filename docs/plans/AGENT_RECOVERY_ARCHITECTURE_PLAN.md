# 🧭 Bản Kế Hoạch: Tái Thiết Cơ Chế Gọi Agent Khi Gặp Lỗi (AI Recovery)

> **Trạng thái:** DRAFT — trình Sếp xem xét & phê duyệt
> **Phạm vi:** `scripts/run-agent.js`, `scripts/ai-healer.js`, `scripts/run-function.js`,
> `scripts/record-ticket.js`, `tests/support/smart-action.ts`, `docs/RUN_AGENT_GUIDE.md`
> **Ngày lập:** 2026-09-28
> **Người lập:** Copilot CLI (theo yêu cầu phân tích của Sếp)

---

## 1. Bối cảnh & Yêu cầu của Sếp

> "Cơ chế gọi agent khi gặp lỗi hiện chưa hợp lý, agent chạy không ổn định và không
> giải quyết được các vấn đề xảy ra."

Tài liệu này (1) mổ xẻ hiện trạng cơ chế **AI Autonomous Recovery**, (2) so sánh 3 mô
hình kiến trúc khả thi, và (3) đề xuất giải pháp Hybrid tối ưu kèm kế hoạch triển khai
từng bước cho bài toán QA Automation trên **Axon Ivy / PrimeFaces**.

---

## 2. Đánh Giá Hiện Trạng — Điểm Nghẽn Cốt Lõi

### 2.1. Luồng hiện tại (`run-agent.js` → `runStepWithAiRescue`)

```
stepFn() lỗi (timeout / locator not found / validation)
   │
   ├─ collectInteractiveElements(taskFrame + page)   ← cào text DOM THÔ, cắt còn 120 phần tử
   │       (tag, text≤80, id, class≤80) — KHÔNG có toạ độ, KHÔNG có cây a11y, KHÔNG screenshot
   │
   ├─ invokeAgentCli(rescuePrompt)                   ← spawnSync copilot/claude, shell:true,
   │       timeout 60s, killSignal SIGKILL           ← tiến trình con dễ vỡ/treo trên Windows
   │
   ├─ parseAiActionJson(output)                      ← kỳ vọng AI trả 1 dòng JSON {action,target,value}
   │
   └─ executeAiAction(scope, page, action)           ← thử selector thô/role/text/label/placeholder
           (tối đa 2 attempt, KHÔNG phản hồi kết quả về AI)
```

### 2.2. Các điểm nghẽn được xác định (map trực tiếp vào code)

| # | Điểm nghẽn | Bằng chứng trong mã | Hệ quả |
|---|------------|---------------------|--------|
| **N1** | **Ngữ cảnh quá nghèo** — AI chỉ thấy text DOM cắt vụn | `collectInteractiveElements()` chỉ trả `tag/text/id/class`, `.slice(0, 400)` rồi lại `.slice(0, 120)` | AI **đoán mò** `target`, thường không khớp element → click trượt |
| **N2** | **Không hiểu PrimeFaces / frame scoping** | Rescue chạy trên `taskFrame \|\| page` nhưng element thật nằm trong `iframe[title="Task frame"]`, native `<input>` bị ẩn sau `ui-helper-hidden-accessible` | AI chọn `<input>` ẩn → không tương tác được |
| **N3** | **Không có vòng phản hồi (no feedback loop)** | `executeAiAction` trả `true/false`, nhưng kết quả **không được gửi lại** cho AI ở attempt kế tiếp | AI lặp lại cùng 1 đề xuất sai, 2 attempt = 2 lần đoán mù |
| **N4** | **Tiến trình con CLI mong manh trên Windows** | `spawnSync('copilot'/'claude', shell:true, timeout:60000, killSignal:'SIGKILL')` + comment về "Terminate batch job (Y/N)?" | Treo/vỡ tiến trình, phải SIGKILL, mất toàn bộ output đang stream |
| **N5** | **Độ trễ cao & chi phí token** | Mỗi rescue gọi CLI (khởi tạo model, ~60s timeout) × 2 attempt × mỗi step | 1 lần chạy chậm 5–8 phút (theo `RUN_AGENT_GUIDE.md`), tốn 5k–20k token |
| **N6** | **Chỉ chữa "triệu chứng", không chữa "gốc"** | Rescue chỉ click/fill cho qua bước rồi chạy tiếp; **POM/spec không được cập nhật** | Lần chạy sau **vẫn lỗi y hệt** — không hội tụ |
| **N7** | **Ranh giới AI Rescue (runtime) vs AI Healer (offline) chồng lấn** | `run-agent.js` chữa runtime; `ai-healer.js` sửa file POM sau đó — hai cơ chế rời rạc, không chia sẻ ngữ cảnh | Trùng lặp, khó bảo trì, không tận dụng `trace`/`last-failure-context.json` |
| **N8** | **Fallback CLI ngây thơ** | `autoFallback`: copilot↔claude khi `status!==0` hoặc hết quota | Fallback đôi khi lặp lại lỗi hạ tầng thay vì lỗi logic → tốn thêm 60s |

### 2.3. Kết luận đánh giá

Cơ chế hiện tại là **"micro-action healing mù"**: AI phải ra quyết định chính xác ở
cấp thao tác (click/fill) nhưng lại bị bịt mắt (ngữ cảnh nghèo, sai frame, không phản
hồi). Đây là lý do **chạy không ổn định** (N1–N4) và **không giải quyết gốc rễ** (N6).

Điểm tích cực đã có sẵn để tận dụng:
- ✅ `smart-action.ts` đã có **heuristic fallback** + dump `last-failure-context.json`.
- ✅ `playwright.config.ts` đã bật `trace: retain-on-failure`, `screenshot: only-on-failure`, `video`.
- ✅ `ai-healer.js` đã có khung **offline self-healing** (đọc lỗi → sửa POM → retest).
- ✅ POM đã kiểm chứng (`tests/pages/functions/*Page.ts`) — nguồn "sự thật" đáng tin.

---

## 3. So Sánh 3 Mô Hình Kiến Trúc

### Mô hình 1 — Runtime Micro-Action Healing (cải tiến bản hiện tại)

**Ý tưởng:** giữ cơ chế cứu nguy tại thời điểm chạy, nhưng nạp **ngữ cảnh giàu** cho AI:
Playwright **accessibility snapshot** (`page.accessibility.snapshot()` / `locator.ariaSnapshot()`)
+ **screenshot** + frame scoping đúng, và thêm **vòng phản hồi có retry** (gửi kết quả
attempt trước cho AI).

| Tiêu chí | Đánh giá |
|----------|----------|
| Ổn định | 🟡 Trung bình — cải thiện N1/N2/N3 nhưng vẫn phụ thuộc CLI con (N4) |
| Tốc độ | 🔴 Chậm — vẫn gọi AI trong vòng đời chạy test |
| Giải quyết gốc | 🔴 Không — vẫn chỉ vá triệu chứng runtime (N6) |
| Chi phí token | 🔴 Cao |
| Độ khó triển khai | 🟢 Thấp — mở rộng code sẵn có |
| Phù hợp CI/CD | 🔴 Kém (non-deterministic, tốn quota) |

**Kết luận:** tốt cho **demo/exploratory**, không phù hợp làm cơ chế chính cho regression.

---

### Mô hình 2 — Smart Deterministic Fallback + Macro AI Plan

**Ý tưởng:** ưu tiên **heuristic/POM đã biết** (mở rộng `smart-action.ts` thành thư viện
PrimeFaces resilient locators). AI **không** can thiệp cấp thao tác; chỉ được gọi ở
**cấp vĩ mô** khi kịch bản **rẽ nhánh** (ví dụ: dialog lạ, popup xác nhận ngoài kịch
bản) để chọn *bước tiếp theo nên làm gì*, không phải *click selector nào*.

| Tiêu chí | Đánh giá |
|----------|----------|
| Ổn định | 🟢 Cao — 90%+ lỗi PrimeFaces xử lý bằng heuristic deterministic |
| Tốc độ | 🟢 Nhanh — hầu như không gọi AI |
| Giải quyết gốc | 🟡 Một phần — heuristic bền hơn nhưng POM lỗi vẫn cần sửa tay |
| Chi phí token | 🟢 Rất thấp |
| Độ khó triển khai | 🟡 Trung bình — cần chuẩn hoá thư viện locator PrimeFaces |
| Phù hợp CI/CD | 🟢 Tốt (deterministic) |

**Kết luận:** nền tảng vững cho **độ ổn định**, giảm phụ thuộc AI. Nhưng chưa tự sửa
được POM/spec khi UI thay đổi thật.

---

### Mô hình 3 — Post-Run Offline Self-Healing (AI Healer đọc trace)

**Ý tưởng:** test chạy **deterministic** (không AI trong luồng). Khi fail → Playwright
đã sinh **`trace.zip` + screenshot + `last-failure-context.json`**. Sau đó pipeline gọi
**AI Healer** đọc trace/error → phân tích → **patch trực tiếp POM/spec** → **retest tự
động** cho đến khi pass. (`ai-healer.js` đã có khung này.)

| Tiêu chí | Đánh giá |
|----------|----------|
| Ổn định | 🟢 Cao — luồng chạy tách khỏi AI, không treo giữa chừng |
| Tốc độ (lần chạy) | 🟢 Nhanh — AI chạy offline, ngoài đường găng |
| Giải quyết gốc | 🟢 Có — sửa POM/spec, lần sau hết lỗi (hội tụ) |
| Chi phí token | 🟡 Trung bình — chỉ gọi khi có fail |
| Độ khó triển khai | 🟡 Trung bình — cần nạp trace vào prompt + guardrails sửa file |
| Phù hợp CI/CD | 🟢 Tốt — chạy như job "self-heal" tách biệt, tạo PR |

**Điểm cần gia cố cho `ai-healer.js` hiện tại:**
- Chưa nạp **nội dung trace/screenshot** vào prompt (chỉ gửi `step/action/error` text).
- Chưa có **giới hạn vòng lặp heal** & **diff review** (rủi ro AI sửa hỏng POM — N gần
  giống N6 nhưng ngược chiều).
- Chưa **chống hồi quy**: cần chạy lại toàn bộ suite liên quan sau heal.

**Kết luận:** đây là mô hình **giải quyết gốc rễ** đúng như Sếp mong muốn.

---

## 4. Đề Xuất: Kiến Trúc HYBRID (Mô hình 2 + 3, tuỳ chọn Mô hình 1 cho demo)

> **Nguyên tắc vàng:** *Deterministic khi chạy — AI khi chữa.*
> Không để AI ra quyết định thao tác trong vòng đời test (nguồn gốc bất ổn định).
> AI chỉ vào cuộc **sau khi fail**, với đầy đủ trace/screenshot, để **vá gốc**.

### 4.1. Sơ đồ tổng thể

```
                    ┌────────────────────────────────────────────┐
                    │  TẦNG 1 — RUN (Deterministic, 0 token)      │
                    │  run-function.js + smart-action.ts (mở rộng)│
                    │  • PrimeFaces resilient locator library     │
                    │  • Frame scoping chuẩn (Task frame)         │
                    │  • waitAjaxIdle, retry heuristic có chủ đích │
                    └───────────────┬────────────────────────────┘
                                    │ PASS → xong (đường chính CI/CD)
                                    │ FAIL ↓ (sinh trace.zip + screenshot
                                    │        + last-failure-context.json)
                    ┌───────────────▼────────────────────────────┐
                    │  TẦNG 2 — DECIDE (Macro AI, chỉ khi rẽ nhánh)│
                    │  Phân loại lỗi:                              │
                    │   • Lỗi hạ tầng (network/SSO) → retry/thoát  │
                    │   • Lỗi locator/UI đổi        → sang Tầng 3  │
                    │   • Rẽ nhánh ngoài kịch bản   → hỏi AI macro │
                    └───────────────┬────────────────────────────┘
                                    │
                    ┌───────────────▼────────────────────────────┐
                    │  TẦNG 3 — HEAL (Offline AI, vá gốc)         │
                    │  ai-healer.js (nâng cấp)                    │
                    │  • Nạp trace + screenshot + POM vào prompt   │
                    │  • Patch POM/spec + guardrails + diff        │
                    │  • Retest ≤ N vòng → tạo PR nếu pass         │
                    └─────────────────────────────────────────────┘

  (Tuỳ chọn) Mode 2 hiện tại → giữ làm "AGENT DEMO MODE" cho trình diễn trực quan,
  KHÔNG dùng trong CI/CD.
```

### 4.2. Vì sao Hybrid tối ưu cho Axon Ivy / PrimeFaces

- PrimeFaces sinh **dynamic ID** + **AJAX re-render** → cần heuristic deterministic
  (Tầng 1) thay vì để AI đoán từng lần (bất ổn định).
- Khi UI **thay đổi thật** (module Ivy nâng cấp) → cần vá gốc POM (Tầng 3), không vá
  triệu chứng runtime.
- CI/CD cần **xác định & rẻ** → Tầng 1 gánh 90%+; AI chỉ tốn token khi thật sự fail.

---

## 5. Kế Hoạch Triển Khai (Implementation Plan) — Từng Bước

### 🎯 Giai đoạn 0 — Chuẩn hoá nền móng (0.5 ngày)
- [ ] **0.1** Chuẩn hoá `last-failure-context.json`: bổ sung `tracePath`, `screenshotPath`,
      `frameUrl`, `selectorTried`, `pomPath`, `specPath`, `stepName`. *(sửa `smart-action.ts`)*
- [ ] **0.2** Đảm bảo `playwright.config.ts` giữ `trace: retain-on-failure`,
      `screenshot: only-on-failure` (đã có) và thêm `outputDir` ổn định để Healer định vị artifact.
- [ ] **0.3** Thống nhất quy ước đường dẫn POM/Spec (đã có trong `resolveFiles()` của `ai-healer.js`).

### 🧱 Giai đoạn 1 — Tầng 1: Deterministic Resilient Layer (2–3 ngày)
- [ ] **1.1** Tạo `tests/support/primefaces.ts`: thư viện locator bền cho PrimeFaces:
      - `selectOneMenu(scope, id)`, `radio(scope, label)`, `checkbox(scope, label)`,
        `datePicker`, `autoComplete` — tất cả tương tác qua **label/role hiển thị**,
        dùng `[id$=":field"]` cho dynamic ID (theo đúng rule trong prompt `ai-healer.js`).
- [ ] **1.2** Nâng cấp `smart-action.ts`: chuẩn hoá `waitAjaxIdle` (gom từ `run-agent.js`),
      frame scoping bắt buộc qua `iframe[title="Task frame"]`, retry heuristic có chủ đích
      (KHÔNG phải retry mù).
- [ ] **1.3** Refactor các POM `tests/pages/functions/*Page.ts` dùng thư viện mới.
- [ ] **1.4** Chạy `npm run test:function <KEY>` toàn bộ suite → đo tỉ lệ pass baseline.

### 🔀 Giai đoạn 2 — Tầng 2: Error Classifier & Macro Decider (1–2 ngày)
- [ ] **2.1** Tạo `scripts/lib/error-classifier.js`: phân loại lỗi từ `last-failure-context.json`:
      `INFRA` (SSO/network) | `LOCATOR` (UI đổi) | `VALIDATION` (thiếu field) | `BRANCH` (dialog lạ).
- [ ] **2.2** `INFRA` → retry deterministic (backoff) rồi thoát rõ ràng; **không** gọi AI.
- [ ] **2.3** `BRANCH` → (tuỳ chọn) gọi **Macro AI**: chỉ hỏi *"bước tiếp theo nên làm gì"*
      ở mức cao, không sinh selector. Trả về hành động thuộc **danh mục hữu hạn** đã whitelist.

### 🩹 Giai đoạn 3 — Tầng 3: Nâng cấp AI Healer Offline (2–3 ngày)
- [ ] **3.1** `ai-healer.js`: nạp **trace + screenshot + đoạn POM liên quan** vào prompt
      (thay vì chỉ `step/action/error`). Đính kèm ảnh cho CLI hỗ trợ vision nếu có.
- [ ] **3.2** **Guardrails sửa file:** yêu cầu AI chỉ đổi locator/action, giữ nguyên tên
      method/param/class (rule đã có); sau khi sửa → chạy `tsc --noEmit` + lint để chặn hỏng cú pháp.
- [ ] **3.3** **Vòng heal có giới hạn:** tối đa `MAX_HEAL_ROUNDS` (mặc định 3). Mỗi vòng:
      sửa → retest → nếu vẫn fail, đưa **kết quả retest** vào prompt vòng sau (feedback loop thật).
- [ ] **3.4** **Chống hồi quy:** sau khi pass, chạy lại nhóm spec liên quan; nếu gãy chỗ khác → revert.
- [ ] **3.5** **Diff review & PR:** ghi `git diff` vào log, tạo nhánh `heal/<KEY>-<timestamp>`
      và mở PR tự động (`gh pr create`) để người review duyệt — **không auto-merge**.

### 🛡️ Giai đoạn 4 — Ổn định hoá tiến trình CLI (1 ngày)
- [ ] **4.1** Thay `spawnSync(..., shell:true)` bằng **spawn không shell** + đường dẫn binary
      tuyệt đối (dùng lại `resolveBinary`), tránh `cmd.exe` "Terminate batch job (Y/N)?".
- [ ] **4.2** Streaming output + timeout mềm (huỷ có kiểm soát) thay cho `SIGKILL` cứng;
      log tiến trình để chẩn đoán khi treo.
- [ ] **4.3** Fallback CLI thông minh: chỉ fallback khi lỗi **quota/hạ tầng**, không fallback
      khi là lỗi logic (tránh tốn thêm 60s vô ích).

### 🔁 Giai đoạn 5 — Định vị lại Mode 2 & Tài liệu (0.5 ngày)
- [ ] **5.1** Đổi `run-agent.js` thành **"AGENT DEMO MODE"**: mặc định KHÔNG dùng trong CI/CD;
      áp dụng cải tiến ngữ cảnh của Mô hình 1 (a11y snapshot + screenshot + feedback loop)
      **chỉ** cho mục đích demo/exploratory.
- [ ] **5.2** Cập nhật `docs/RUN_AGENT_GUIDE.md`: nêu rõ 3 tầng, khi nào dùng cái nào.
- [ ] **5.3** Thêm `npm` scripts: `test:function` (Tầng 1 – CI), `heal` (Tầng 3), `test:agent` (demo).

### ✅ Giai đoạn 6 — Tích hợp CI/CD & Nghiệm thu (1 ngày)
- [ ] **6.1** Pipeline: `run-function` (deterministic) → nếu fail, job `ai-healer` chạy tách,
      tạo PR heal; regression hằng ngày **không** phụ thuộc AI trong đường găng.
- [ ] **6.2** Bộ chỉ số nghiệm thu (mục 6).

---

## 6. Tiêu Chí Nghiệm Thu (Definition of Done)

| Chỉ số | Hiện tại (ước lượng) | Mục tiêu sau triển khai |
|--------|----------------------|-------------------------|
| Tỉ lệ pass deterministic (Tầng 1, không AI) | ~ thấp/không đo | ≥ 90% |
| Thời gian 1 lần chạy (regression/spec) | 5–8 phút (Mode 2) | 2–3 phút (Mode 1) |
| Token/lần chạy xanh (pass) | 5k–20k | 0 |
| Tỉ lệ heal thành công & **hội tụ** (lần sau hết lỗi) | ~0% (chỉ vá runtime) | ≥ 70% tự vá + tạo PR |
| Tiến trình CLI treo/vỡ trên Windows | thường xuyên | ~0 (spawn không shell) |
| Regression do heal gây ra | không kiểm soát | 0 (có chống hồi quy + PR review) |

---

## 7. Rủi Ro & Giảm Thiểu

| Rủi ro | Giảm thiểu |
|--------|-----------|
| AI Healer sửa hỏng POM | `tsc --noEmit` + lint + diff review + PR bắt buộc (không auto-merge) |
| Heuristic PrimeFaces chưa phủ hết case | Bắt đầu từ các module trọng yếu, mở rộng dần; log case chưa phủ |
| Quota CLI cạn giữa chừng | Fallback quota-aware (4.3); heal chạy theo hàng đợi, không đồng thời |
| Refactor POM gây gãy diện rộng | Làm theo từng module + chạy `test:function` baseline sau mỗi bước |
| Trace quá lớn cho prompt | Trích xuất phần liên quan (bước fail ± vài action) thay vì nạp cả trace |

---

## 8. Khuyến Nghị Ưu Tiên

1. **Làm ngay (impact cao, rủi ro thấp):** Giai đoạn 0, 1, 4 — nền deterministic + ổn định
   tiến trình CLI. Đây là phần trực tiếp trị "chạy không ổn định".
2. **Tiếp theo (giải quyết gốc):** Giai đoạn 3 — nâng cấp AI Healer đọc trace + PR review.
   Đây là phần trực tiếp trị "không giải quyết được vấn đề".
3. **Sau cùng (tinh chỉnh):** Giai đoạn 2, 5, 6.

> **Tổng thời gian ước lượng:** ~8–11 ngày công. Có thể giao song song Tầng 1 và Tầng 3.

---

## 9. Tóm Tắt Cho Sếp (TL;DR)

- **Vấn đề gốc:** cơ chế hiện tại bắt AI *đoán thao tác lúc đang chạy* với ngữ cảnh nghèo,
  sai frame, không phản hồi, qua tiến trình CLI con mong manh trên Windows → **bất ổn**
  và **chỉ vá triệu chứng, không vá gốc**.
- **Giải pháp:** **Hybrid** — *Deterministic khi chạy (Tầng 1), AI vá gốc offline khi fail
  (Tầng 3)*. Giữ Mode 2 hiện tại chỉ để **demo**.
- **Kết quả kỳ vọng:** nhanh gấp ~2 lần, 0 token cho lần chạy xanh, ổn định ≥ 90%, và
  **tự hội tụ** (lỗi được vá gốc qua PR, lần sau không lặp lại).
