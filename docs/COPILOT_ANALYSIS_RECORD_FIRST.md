# 🎬 Phân Tích Kiến Trúc: "Sao Không Record Trước Nhỉ?"

> Trả lời trực diện câu hỏi định hướng kiến trúc của Sếp trong dự án **QA-Playwright-ASAP**:
> *"Tại sao không thực hiện Record trước (Tester thao tác giao diện thật để có DOM grounding / Page Object) rồi mới để AI đọc ticket Story và sinh kịch bản/testcase?"*
>
> Tài liệu này khảo sát toàn bộ codebase hiện tại (`scripts/*.js`, `.github/prompts/*.prompt.md`) và đề xuất kiến trúc **"Record-First / Grounding-First"** để hợp nhất 2 pipeline đang rời rạc.

---

## 0. TL;DR — Kết Luận Nhanh Cho Sếp

1. **Ý tưởng "Record trước" là ĐÚNG HƯỚNG về mặt kỹ thuật** và chính là liều thuốc trực tiếp cho căn bệnh gốc "AI đoán mò selector → fail liên tục" đã được ghi nhận trong `docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md` (nguyên nhân R1: *không grounding vào app thật*).
2. **Codebase hiện tại đã có ĐỦ nguyên liệu để làm việc này, nhưng đang bị chia đôi thành 2 pipeline không hàn liền:**
   - `auto-test.js` (Pipeline A): có **AI sinh test-matrix** (TC-01/02/03) từ Story, nhưng **record chỉ là tùy chọn** (`--ground`). Nếu Tester quên record → AI rơi lại về chế độ đoán.
   - `ticket-pipeline.js` (Pipeline B): **đã record-first**, nhưng bước sinh spec là **deterministic bằng regex** (`sync-specs.js`) → chỉ ra **1 starter spec** cho đúng happy-path đã ghi, **KHÔNG có** AI phân rã test-matrix (Validation/Boundary/Role...).
   - ⇒ Cái Sếp muốn = **B (record-first) rồi nối vào Step 3 của A (AI matrix)**. Đây chính xác là "mối hàn còn thiếu".
3. **Đề xuất:** biến `--ground` thành **mặc định**, hợp nhất 2 pipeline thành **một cửa duy nhất** `npm run qa <KEY>` với thứ tự: `fetch → analyze (blocker gate) → RECORD → sync-specs (POM) → AI sinh matrix GROUNDED → run → self-heal`.
4. **Nhưng "Record trước" KHÔNG phải viên đạn bạc:** nó hoàn hảo cho **Happy Path**, nhưng đuối ở **Negative/Validation** (màn báo lỗi chưa hiện khi record), **feature chưa deploy** (không có gì để record), và **flow rẽ nhánh nhiều bước** (1 recording chỉ phủ 1 nhánh). Cần cơ chế lai (hybrid) có kiểm soát cho các ca này — chi tiết ở Mục 2 & 3.

---

## 1. Trả Lời Trực Diện: "Tại Sao Không Record Trước?"

### 1.1. Vì sao hệ thống HIỆN TẠI lại sinh test trước từ văn bản Story?

Không phải vì team không nghĩ tới record — mà vì **quyết định tối ưu token (cost) đã vô tình tách AI khỏi app thật**. Bằng chứng trực tiếp trong code:

- `scripts/auto-test.js` được thiết kế quanh triết lý **model-tiering để tiết kiệm AI Credits** (xem header comment): `fetch (0 token) → /summarize-story (sonnet, rẻ) → /analyze-story + /new-test (opus) → run (0 token)`. Toàn bộ chuỗi này chạy **chỉ trên văn bản** — `summary.json (~30k token)` cô đọng từ Description/AC/ảnh, **không hề mở trình duyệt thật**.
- Trong `auto-test.js`, recording chỉ được nạp **NẾU nó tình cờ tồn tại** (`loadRecordingGroundingTruth()`), và bị coi là "nice-to-have":
  ```js
  const recording = loadRecordingGroundingTruth();  // trả null nếu không có file
  const groundingBlock = recording ? `### 🎯 GROUNDING TRUTH ...` : '';  // rỗng nếu thiếu
  ```
  Cờ `--ground` chỉ *bắt buộc* recording khi Tester **chủ động gõ thêm cờ đó** — mặc định là không.

**Hệ quả (đã được `ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md` mổ xẻ):** khi gặp feature/màn hình mới chưa có Page Object, `/new-test` buộc phải **dịch chữ → code** và **đoán** `getByRole/getByLabel`, đoán số lượng phần tử, đoán text nút. Selector bịa ra không khớp DOM PrimeFaces thật → **fail ngay lần chạy đầu**. Đây đúng là cảm giác của Tester: *"chạy theo testcase thì fail liên tục, dùng prompt (kèm record/nhìn DOM thật) lại hiệu quả hơn"*.

> **Bản chất:** Story là văn bản nghiệp vụ (business intent), còn selector là chi tiết kỹ thuật (DOM implementation). **Không thể suy ra cái thứ hai từ cái thứ nhất một cách tin cậy.** Đó là lý do sinh-test-từ-chữ luôn có một tỉ lệ đoán mò cố hữu.

### 1.2. Đánh giá tính khả thi & hợp lý của quy trình "Record trước" Sếp đề xuất

Đối chiếu 4 bước Sếp nêu với code đang có:

| Bước Sếp đề xuất | Codebase đã có gì? | Đánh giá khả thi |
| :-- | :-- | :-- |
| **B1. Fetch Story (AC, Description, Mockup)** | ✅ `fetch-jira.js` (fetch REST-first + DOM fallback, tải attachments/mockup, lọc icon rác <50KB, kèm Jira Comments làm "Resolution Authority"). | **Sẵn sàng 100%.** Rất bền, chống SSO tốt. |
| **B2. Tester Record Happy Path 30s–1p → tự sinh Page Object chuẩn DOM PrimeFaces** | ✅ `record-ticket.js` (codegen + Layer 1 DOM Annotator gắn `data-stable-label` + Layer 2 PrimeFaces Capture Bridge cho `selectOneMenu`). ✅ `sync-specs.js` bóc recording → **POM TypeScript** (`extractPomModel`) + reverse-ground vào `live_grounded_components.yaml`. | **Sẵn sàng ~85%.** Đây chính là "grounding chuẩn DOM" Sếp muốn. Điểm yếu: recorder dùng API private Playwright (`_enableRecorder`) và Bridge chưa phủ hết widget (multiselect/datepicker/autocomplete) — xem Mục 2. |
| **B3. AI đọc Story + nạp POM & recording → sinh test-matrix `TC-<KEY>.md` (TC-01 Happy, TC-02 Validation, TC-03 Boundary...) + `.spec.ts` KHÔNG đoán mò** | ⚠️ **NỬA VỜI.** `auto-test.js` Step 3 (`/analyze-story` + `/new-test`) **có** logic phân rã test-matrix rất tốt (mục "THIẾT KẾ TEST MATRIX" trong `new-test.prompt.md`), và **có** đọc recording nếu tồn tại. NHƯNG bước này **không được `ticket-pipeline.js` gọi** — pipeline record-first B lại đi đường `sync-specs` deterministic, chỉ ra 1 spec. | **Đây là MẮT XÍCH THIẾU.** Nguyên liệu có đủ, chỉ chưa được nối đúng thứ tự (record → RỒI mới AI-matrix). |
| **B4. Thực thi (First-Time Green)** | ✅ `playwright test` + `ai-healer.js` (self-heal có guardrail `tsc` + auto-revert). | **Sẵn sàng.** |

**Kết luận Mục 1:** Quy trình "Record trước" của Sếp **không những khả thi mà còn là hướng đi đúng đắn nhất** để đạt "First-Time Green". Toàn bộ 4 bước đều đã có script tương ứng. Vấn đề **không phải thiếu công nghệ**, mà là **thiếu sự hợp nhất (orchestration)**: hai pipeline A và B đang chạy song song, khâu với nhau lỏng lẻo qua cờ `--ground`/`--regenerate` và reverse-grounding, thay vì là **một luồng Grounding-First mặc định**.

### 1.3. Vì sao "Record trước" giải quyết đúng bệnh gốc

| Bệnh gốc (từ ROOT_CAUSE) | "Record trước" chữa như thế nào |
| :-- | :-- |
| **R1** — AI bịa selector vì không thấy app | Recording = **bằng chứng DOM thật**, selector không thể "nói dối" về cái đã render. |
| **R4** — Không có Page Object để tái dùng | `sync-specs.js` **sinh POM ngay từ recording**, cho AI một hợp đồng locator để bám vào (cấm gọi method không tồn tại). |
| **R2** — Bỏ MCP để tiết kiệm token | Record là "grounding 1 lần, tái dùng vô hạn": tốn công Tester ~1 phút thay vì đốt token MCP mọi lúc; reverse-grounding còn tái dùng chéo ticket. |
| **R5/R6** — Test chưa từng xanh bị quy oan "bug web" | Recording chứng minh feature **đang chạy thật** → gỡ `test.fixme`, và Baseline Gate biết đây là lỗi tác giả chứ không phải bug web. |

---

## 2. Đánh Giá Đa Chiều (Ưu / Nhược / Rủi Ro / Edge Cases)

### 2.1. ✅ Ưu điểm

1. **Diệt tận gốc "đoán mò selector"** — nguyên nhân số 1 gây fail liên tục. Selector đến từ DOM thật, không từ trí tưởng tượng của model.
2. **Sinh Page Object miễn phí, chuẩn PrimeFaces** — `sync-specs.js` đã có luật thực chiến (click `<label>` cho radio/checkbox, `.filter({visible:true}).first()` cho nút Next/Submit, biến ID ephemeral Axon Ivy `/faces/instances/...` thành regex ổn định chống "View Expired").
3. **Tri thức tích lũy (reverse-grounding)** — mỗi lần record, selector thật được merge vào `live_grounded_components.yaml` với `origin: live_recording_<KEY>`; ticket **sau** tái dùng ngay tri thức của ticket **trước**, kể cả khác KEY. Càng dùng càng ít đoán.
4. **First-Time Green khả thi thật** — recording chứng minh flow chạy được, nên AI được phép gỡ `test.fixme` và tự tin rằng happy-path sẽ xanh.
5. **Chi phí token thấp hơn cả hiện tại** — thay vì để opus "vật lộn suy đoán" DOM từ ảnh, ta đưa thẳng selector đúng; model chỉ còn việc **thiết kế nghiệp vụ test-matrix**, đúng thế mạnh của nó.
6. **Human-in-the-loop đặt đúng chỗ** — Tester chỉ tốn 30s–1 phút cho thứ máy làm dở nhất (khám phá UI thật), rồi giao lại phần máy làm giỏi (phân rã ca kiểm thử) cho AI.

### 2.2. ⚠️ Nhược điểm & Rủi ro

1. **Recorder là khu vực giòn nhất** (đã ghi trong review, G2.1–G2.5):
   - Dùng **API private** `context._enableRecorder(...)` — nâng cấp Playwright có thể phá vỡ.
   - Annotator chỉ **gắn attribute**, KHÔNG ép Codegen dùng — selector cuối vẫn do Codegen tự quyết.
   - Capture Bridge mới phủ `selectOneMenu`; **bỏ sót** `selectCheckboxMenu`, autocomplete, datepicker, tree/table. Tester có thể phải record lại khi AJAX timing nuốt mất thao tác.
2. **Ma sát cho Tester** — record-first bắt Tester **luôn phải mở trình duyệt** cho mọi ticket, kể cả ticket đơn giản hay lặp lại. Nếu không thiết kế wizard mượt, đây là gánh nặng thao tác.
3. **Recording chỉ phủ những gì Tester bấm** — mọi field/nút Tester **không chạm tới** sẽ không có selector. Test-matrix mà AI thiết kế có thể cần phần tử **ngoài** phạm vi recording.
4. **Nền parser regex** (`sync-specs`/`md-to-spec` đọc code bằng regex, không AST) — recording phức tạp (locator nhiều dòng, chain `.filter().nth()`) dễ làm POM sai âm thầm.
5. **Rủi ro "grounding giả an toàn"** — recording sạch không đảm bảo AI **hiểu đúng nghiệp vụ**; nó chỉ đảm bảo selector đúng. AI vẫn có thể assert sai kỳ vọng.

### 2.3. 🧩 Các Edge Cases QUAN TRỌNG (chỗ "Record trước" đuối)

Đây là phần Sếp hỏi kỹ nhất — **"chỗ báo lỗi chưa xuất hiện trong recording thì locator lấy từ đâu?"**:

| Edge case | Vấn đề | Giải pháp đề xuất |
| :-- | :-- | :-- |
| **① Negative / Validation test** (TC-02) | Tester record **Happy Path** → **không có** thông báo lỗi nào render → không có locator cho message lỗi. | **3 lớp fallback theo thứ tự:** (a) **Record 2 lượt ngắn** — happy path + 1 lượt "cố tình bỏ trống field bắt buộc rồi bấm Submit" để bắt đúng container lỗi (`p-message`/`.ui-message-error`); (b) nếu Tester không record ca lỗi → AI tra `ui_components.yaml` lấy `required` + container lỗi chuẩn PrimeFaces đã biết; (c) nếu vẫn không có → sinh test-matrix nhưng đánh dấu `// ⚠️ CHƯA GROUNDED: error locator` + gợi ý `/ground-page`, **không bịa rồi để đỏ giả**. |
| **② Feature CHƯA deploy lên web test** | Không có gì để record. Record-first sẽ **bế tắc**. | **Fallback về AI-draft mode**: khi `analyze-story` xác nhận màn hình không có trong `ui_components.yaml`/không truy cập được → **bỏ qua bước record**, AI vẫn sinh đầy đủ test-matrix nhưng chèn `test.fixme(true, 'Feature not yet deployed')` cho **mỗi** TC con (logic này `new-test.prompt.md` đã có sẵn). Khi feature lên server → Tester record → `regenerate` gỡ `test.fixme`. |
| **③ Flow rẽ nhánh nhiều bước** (workflow Axon Ivy) | 1 recording chỉ phủ **1 nhánh** (ví dụ nhánh "Approve"); nhánh "Reject" / role khác không có selector. | (a) Cho phép **nhiều recording cho 1 KEY** (`<KEY>.recording.ts`, `<KEY>.reject.recording.ts`...) và nạp tất cả làm grounding; (b) tận dụng **reverse-grounding cross-ticket**: nhánh chung (login, điều hướng) đã có selector từ ticket trước; (c) AI phủ nhánh chưa record bằng cách **tái dùng POM method** của các phần tử chung, chỉ đánh dấu bước riêng của nhánh là chưa grounded. |
| **④ Trạng thái/dữ liệu tiền đề** (cần "đã có 1 task" trước khi test) | Recording bắt đầu từ trạng thái Tester đang có, khó tái lập. | `new-test.prompt.md` đã bắt buộc `beforeEach` tạo precondition tường minh + `ensureAuthenticated()`. Giữ nguyên. |
| **⑤ Boundary / dữ liệu biên** (TC-03) | Giá trị biên (rỗng/âm/vượt ngưỡng) không xuất hiện trong record happy path. | Selector field **giống hệt** happy path (đã record) → chỉ **thay test data**. Đây là ca record-first **phủ tốt** vì locator dùng lại được, chỉ đổi giá trị nhập/assert. |

### 2.4. ⚖️ Cân bằng Human-in-the-loop ↔ Tự động hóa

| Mức độ | Ai làm gì | Khi nào dùng |
| :-- | :-- | :-- |
| **Máy tối đa** (hiện tại A) | AI sinh hết từ chữ, không record | Chỉ hợp lý khi POM/live-grounding đã đủ dày (ticket lặp lại màn hình cũ) |
| **★ Record-First (đề xuất)** | Tester record 30s–1p happy path → AI sinh matrix | **Mặc định cho mọi feature/màn hình MỚI** |
| **Human tối đa** (`md-to-spec`) | Tester viết `.md` DSL, compile 0 token | Regression ổn định, Tester muốn kiểm soát tuyệt đối |

> **Nguyên tắc vàng đề xuất:** *"Record cái máy không biết (DOM thật), giao cho AI cái máy giỏi (thiết kế test-matrix nghiệp vụ)."* — Tester không viết code, không đoán selector; chỉ **thao tác thật 1 phút** và **duyệt kết quả**.

### 2.5. Khi nào "Record trước" hoạt động HOÀN HẢO nhất?

- ✅ Feature **đã deploy** và truy cập được trên `BASE_URL` với session `.auth/user.json`.
- ✅ Luồng nghiệp vụ chính là **tuyến tính** (form nhập → submit → xác nhận), đúng chất Happy Path.
- ✅ UI dùng widget **Bridge đã phủ** (input, button, `selectOneMenu`, radio/checkbox).
- ✅ Ticket có **Validation/Boundary** dùng **lại chính field** của happy path → chỉ đổi data.
- ⛔ Kém hiệu quả khi: feature chưa lên server, luồng rẽ nhánh phức tạp phụ thuộc role/state, hoặc widget lạ chưa được Bridge hỗ trợ.

---

## 3. Đề Xuất Kiến Trúc & Giải Pháp Kỹ Thuật

### 3.1. Kiến trúc mục tiêu — "Grounding-First" hợp nhất

```
                       npm run qa <KEY>            (một cửa duy nhất)
                              │
   ┌──────────────────────────┼───────────────────────────────────────────────┐
   │ [1] fetch-jira.js  ──►  docs/tickets/<KEY>.md (+ attachments)  [0 token]   │
   │                          │                                                 │
   │ [2] /summarize-story ──► <KEY>.summary.json                    [sonnet]    │
   │                          │                                                 │
   │ [3] /analyze-story ────► BLOCKER GATE                          [opus]      │
   │        │                  ├─ 🔴 Blocker  → dừng, xuất Bảng Câu Hỏi (exit 2)│
   │        │                  └─ 🟢 Safe → tiếp                                │
   │        ▼                                                                    │
   │ [4] FEATURE LIVE? ── không ──► AI-draft + test.fixme (fallback ca ②)       │
   │        │ có                                                                 │
   │        ▼                                                                    │
   │ [5] RECORD (record-ticket.js) ─► <KEY>.recording.ts    ← Tester 30s–1p     │
   │        │   (gợi ý: happy path + 1 lượt validation ngắn — ca ①)             │
   │        ▼                                                                    │
   │ [6] sync-specs.js ─► POM (tests/pages/<Key>Page.ts)                        │
   │        │            + reverse-ground ─► live_grounded_components.yaml       │
   │        ▼                                                                    │
   │ [7] AI GENERATE MATRIX (/new-test, GROUNDED bắt buộc)          [opus]      │
   │        │   input: Story + POM + recording + live-grounding                 │
   │        │   output: TC-<KEY>.md (TC-01 Happy/02 Validation/03 Boundary...)  │
   │        │           + tests/e2e/TC-<KEY>.spec.ts (tái dùng POM, KHÔNG đoán) │
   │        ▼                                                                    │
   │ [8] playwright test ─► FAIL ─► ai-healer.js (tsc guard + revert) [0 token] │
   └────────────────────────────────────────────────────────────────────────────┘
```

**Điểm mấu chốt:** so với hiện tại, chỉ cần **chèn bước [5]+[6] (record → POM) VÀO GIỮA [3] và [7]** của `auto-test.js`, và **đặt `analyze-story` (blocker gate) TRƯỚC record** để không lãng phí công Tester record một story còn mâu thuẫn.

### 3.2. Cần sửa/hợp nhất những script nào?

| Script | Thay đổi đề xuất | Mục đích |
| :-- | :-- | :-- |
| **`auto-test.js`** | (a) Biến `--ground` thành **mặc định** — mọi feature mới bắt buộc grounding, cho phép `--no-ground` (kèm cảnh báo test là draft `// ⚠️ CHƯA GROUNDED`). (b) **Chèn bước record + sync-specs** giữa `analyze-story` và `generate`. (c) Nếu recording chưa tồn tại và feature live → **tự khởi động recorder** thay vì im lặng bỏ qua. | Đây là script trở thành xương sống hợp nhất. |
| **`ticket-pipeline.js`** | **Hợp nhất vào `auto-test.js`** rồi trở thành alias mỏng (hoặc xóa). Hiện nó trùng bước fetch/record/run nhưng thiếu blocker-gate + AI matrix. Không nên duy trì 2 pipeline. | Xóa sự phân mảnh "chọn nhầm pipeline" (điểm nghẽn đã ghi trong review). |
| **`sync-specs.js`** | Chạy **TRƯỚC** bước AI (không phải sau) để POM có mặt như **hợp đồng locator** cho `/new-test` tái dùng. Giữ nguyên `--no-spec` (chỉ sinh POM, để AI sinh spec matrix thay vì starter spec đơn). Trung hạn: hợp nhất `extractComponents` + `extractPomModel` thành **một** bộ trích xuất (khắc phục G3.2). | POM = grounding truth AI bắt buộc dùng, thay vì để AI tự chế selector. |
| **`md-to-spec.js`** | Giữ làm **nhánh song song** cho Tester tự viết `.md` (regression). Bổ sung: cho `include` file ngoài + tham số hóa data (khắc phục G3.5). Không nằm trong luồng record-first mặc định. | Giữ lựa chọn "human tối đa" cho ca cần kiểm soát tuyệt đối. |
| **`record-ticket.js`** | (a) Bọc `_enableRecorder` sau **adapter + pin phiên bản Playwright** + test hồi quy cảnh báo khi API private đổi (G2.1). (b) Mở rộng Capture Bridge cho `selectCheckboxMenu`/autocomplete/datepicker (G2.4). (c) Tự dọn `.playwright-recorder-launcher.tmp.js` kể cả khi crash (G2.5). | Củng cố khâu giòn nhất trước khi biến nó thành bước bắt buộc. |

### 3.3. Cần tinh chỉnh prompt AI nào?

| Prompt | Tinh chỉnh đề xuất |
| :-- | :-- |
| **`analyze-story.prompt.md`** | (a) Chạy **trước** record (đã là pre-flight, chỉ cần orchestration đặt đúng chỗ). (b) Thêm mục ở "Đầu ra": kết luận **"Feature LIVE hay CHƯA DEPLOY"** để bước [4] quyết định record hay fallback `test.fixme`. (c) Thêm cảnh báo YAML grounding cũ nếu `ui_components.yaml` cũ hơn commit code (G1.1/R7). |
| **`new-test.prompt.md`** | (a) Khi có recording → nâng từ "ưu tiên cao nhất" thành **BẮT BUỘC tái dùng POM/recording, cấm sinh locator ngoài POM cho phần tử đã có trong recording**. (b) Với TC Negative/Validation: quy định rõ **thứ tự fallback lấy error-locator** (record lượt 2 → `ui_components.yaml` → `// ⚠️ CHƯA GROUNDED`) như ca ① Mục 2.3. (c) Với flow rẽ nhánh: cho phép **nạp nhiều recording** cho 1 KEY. (Mục "THIẾT KẾ TEST MATRIX" giữ nguyên vì đã rất tốt.) |
| **`record-ticket.prompt.md`** | Bổ sung hướng dẫn Tester: *"record happy path xong, nếu ticket có Validation, record thêm 1 lượt cố tình để trống field bắt buộc rồi Submit để bắt màn báo lỗi"* — giải quyết ca ① ngay từ nguồn. |
| **`ground-page.prompt.md`** | Giữ làm công cụ **vá selector còn thiếu** sau khi AI đánh dấu `// ⚠️ CHƯA GROUNDED` (ví dụ error-message container không record được). |

### 3.4. Thiết kế lệnh thực thi DUY NHẤT (CLI Wizard)

Mục tiêu: Tester **không cần nhớ** `auto-test` vs `ticket` vs `record:function`. Một lệnh, wizard tự quyết nhánh:

```bash
npm run qa <KEY>          # ví dụ: npm run qa SEC-11359
```

**Luồng tương tác wizard (`scripts/qa.js` — orchestrator mới):**

```
$ npm run qa SEC-11359

  [1/8] 📥 Đang fetch story SEC-11359 từ Jira... ✔ (docs/tickets/SEC-11359.md)
  [2/8] 🧠 Tóm tắt story (sonnet)... ✔
  [3/8] 🔎 Phân tích xung đột (opus)...
        🟢 STORY AN TOÀN ĐỂ SINH TEST.
  [4/8] 🌐 Kiểm tra feature trên BASE_URL... ✔ Feature LIVE.

        ┌─ Bạn muốn làm gì? ─────────────────────────────┐
        │ > [R] Record luồng thật (khuyến nghị cho feature mới)  │
        │   [S] Bỏ qua record, dùng grounding đã có (POM/live)   │
        │   [D] Draft không grounding (đánh dấu CHƯA GROUNDED)   │
        └─────────────────────────────────────────────────┘
        Lựa chọn [R]: R

  [5/8] 🎬 Mở trình duyệt ghi hình. Hãy thao tác Happy Path rồi ĐÓNG trình duyệt.
        💡 Có Validation? Record thêm 1 lượt bỏ trống field bắt buộc + Submit.
        ... (Tester thao tác 45s) ... ✔ (tests/recordings/SEC-11359.recording.ts)
  [6/8] 🔧 Sinh Page Object + reverse-ground... ✔ (SecPage.ts + live_grounded_components.yaml)
  [7/8] 🤖 AI thiết kế test-matrix GROUNDED (opus)...
        ✔ TC-SEC-11359-01 Happy Path
        ✔ TC-SEC-11359-02 Validation (bắt buộc field trống)
        ✔ TC-SEC-11359-03 Boundary
  [8/8] ▶️  Chạy Playwright... 🟢 3 passed (First-Time Green!)

  ✅ HOÀN TẤT. Xem báo cáo: npm run report
```

**Nguyên tắc thiết kế wizard:**
- **Zero-memory cho Tester:** không cần nhớ cờ nào; wizard tự hỏi đúng lúc.
- **Mặc định thông minh:** feature live → gợi ý `[R] Record`; feature chưa deploy → tự nhảy nhánh `[D] Draft + test.fixme`, không hỏi.
- **Bỏ qua an toàn:** đã có recording/POM → hỏi "record lại hay dùng cái cũ?" (giống `--skip-record` hiện tại).
- **Chế độ CI (không tương tác):** `npm run qa <KEY> --ci` → không mở recorder, dùng grounding có sẵn hoặc `test.fixme`, phù hợp pipeline tự động.
- **Nút thoát blocker:** nếu Step [3] ra Blocker → wizard dừng ngay tại [3], in Bảng Câu Hỏi, **không phí công record** (exit code 2 để CI phân biệt).

### 3.5. Lộ trình triển khai đề xuất

| Sprint | Việc | Khắc phục |
| :-- | :-- | :-- |
| **1 — Hàn luồng** | Chèn record+sync-specs vào `auto-test.js`; `--ground` thành mặc định; viết `scripts/qa.js` wizard; hợp nhất `ticket-pipeline.js`. | Mắt xích thiếu (Mục 1.2), "chọn nhầm pipeline". |
| **2 — Edge cases** | Fallback feature-chưa-deploy; thứ tự lấy error-locator cho Validation; hỗ trợ nhiều recording/nhánh; sửa `new-test.prompt.md` + `record-ticket.prompt.md`. | Ca ①②③ Mục 2.3. |
| **3 — Củng cố recorder** | Adapter + pin Playwright cho `_enableRecorder`; mở rộng Capture Bridge; tự dọn temp. | G2.1, G2.4, G2.5. |
| **4 — Nền tảng** | regex → AST cho `sync-specs`/`md-to-spec`; hợp nhất 2 bộ trích xuất; cảnh báo YAML cũ. | G3.1, G3.2, G1.1. |

---

## 4. Kết Luận

**Trả lời thẳng câu hỏi của Sếp:** *"Đúng, nên record trước — và hệ thống gần như đã sẵn sàng để làm điều đó."*

- Ý tưởng "Record trước" **không chỉ hợp lý mà là hướng kiến trúc đúng nhất** để chấm dứt bệnh "AI đoán mò selector → fail liên tục". Nó đặt con người và máy vào đúng vai: **Tester khám phá DOM thật (1 phút), AI thiết kế test-matrix nghiệp vụ.**
- Toàn bộ nguyên liệu đã có (`fetch-jira`, `record-ticket`, `sync-specs`, `analyze-story`, `new-test`, `ai-healer`). **Thiếu duy nhất phần hợp nhất:** hiện `auto-test.js` có AI-matrix nhưng record tùy chọn; `ticket-pipeline.js` record-first nhưng không AI-matrix. Chỉ cần **nối record → sync-specs → AI-matrix** vào một luồng và biến grounding thành **mặc định**.
- **Không tuyệt đối hóa record-first:** phải có nhánh lai (hybrid) cho 3 edge case cứng — **Validation** (record lượt 2 / `ui_components.yaml` / đánh dấu chưa grounded), **feature chưa deploy** (AI-draft + `test.fixme`), **flow rẽ nhánh** (nhiều recording + reverse-grounding cross-ticket).
- **Trải nghiệm Tester:** gói tất cả sau **một lệnh wizard `npm run qa <KEY>`** — zero-memory, mặc định thông minh, dừng sớm khi Blocker.

> **Một câu cho Sếp:** *Record-first biến bài toán "dịch chữ thành selector" (bất khả tin) thành bài toán "thiết kế ca kiểm thử trên selector đã đúng" (đúng sở trường của AI). Đó là lý do nên record trước.*

---

### 📎 Phụ lục — Tài liệu liên quan
- `docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md` — phân tích bệnh gốc "đoán mò selector" (R1–R7).
- `docs/COPILOT_REVIEW_QUY_TRINH_TEST.md` — review toàn vòng đời 4 giai đoạn, danh mục lỗ hổng G1–G4 và khuyến nghị R1–R12.
- `.github/prompts/new-test.prompt.md` — mục "THIẾT KẾ TEST MATRIX" & "NGUYÊN TẮC SỐ 1 — CẤM ĐOÁN".
- `scripts/auto-test.js` (Pipeline A) & `scripts/ticket-pipeline.js` (Pipeline B) — hai pipeline cần hợp nhất.
