# 📋 Báo Cáo Review Quy Trình Kiểm Thử Theo Ticket — QA-Playwright-ASAP

> **Người thực hiện:** GitHub Copilot CLI (Claude Opus 4.8)
> **Phạm vi:** Toàn bộ vòng đời từ *đọc User Story → sinh testcase gợi ý → record → sinh code → thực thi & tự chữa lành*.
> **Ngày:** 2026-09-28
> **Mục tiêu:** Đánh giá luồng End-to-End, nhận diện điểm mạnh / điểm nghẽn / lỗ hổng, và đề xuất lộ trình tối ưu trải nghiệm Tester.

---

## 1. Tóm Tắt Điều Hành (Executive Summary)

Dự án đã xây dựng được một khung kiểm thử E2E **có kiến trúc rõ ràng, tư duy tốt và nhiều cơ chế an toàn đáng khen** cho ứng dụng Axon Ivy / PrimeFaces — một môi trường vốn **rất khó tự động hoá** vì DOM động, ID sinh tự động và overlay AJAX. Điểm nổi bật nhất là triết lý **"Grounding — selector không bao giờ được đoán mò"** và mô hình **phân tầng chi phí AI** (model rẻ để đọc/tóm tắt, model mạnh để suy luận, engine local 0 token để chạy).

Tuy nhiên, hệ thống hiện tồn tại **một mâu thuẫn kiến trúc cốt lõi**: đang có **HAI pipeline song song, chồng lấn và chưa hợp nhất** để sinh ra cùng một loại artefact (Test Spec):

| Pipeline | Lệnh | Cách sinh test | Bản chất |
|---|---|---|---|
| **A. AI-driven** | `npm run auto-test <KEY>` | AI đọc Story → suy luận → sinh `.spec.ts` | Thông minh, nhưng dễ "đoán" nếu thiếu grounding |
| **B. Record-driven** | `npm run ticket <KEY>` | Tester record tay → parser sinh POM + `.spec.ts` | Bám thực tế, nhưng thủ công và giòn (regex parser) |

Chính nhóm phát triển đã **tự nhận diện** mâu thuẫn này trong tài liệu nội bộ `docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md` — nơi ghi lại phản hồi kinh điển của Tester: *"Chạy theo testcase thì fail liên tục, còn dùng prompt/record thì hiệu quả hơn"*. Đây chính là câu trả lời trực tiếp cho câu hỏi của Sếp về "lệch pha giữa AI sinh testcase và Record thực tế". Vấn đề đã được **vá một phần** (thêm `--ground`, reverse-grounding, Baseline Gate) nhưng **chưa được hợp nhất triệt để** thành một luồng duy nhất.

**Xếp hạng tổng thể:** 🟢 Nền tảng vững, tư duy cao cấp — nhưng cần **hợp nhất luồng** và **siết an toàn khi AI sửa code** để đạt độ tin cậy sản xuất.

---

## 2. Bản Đồ Kiến Trúc Vòng Đời Kiểm Thử

```
                    ┌─────────────────── GIAI ĐOẠN 1: ĐỌC STORY ───────────────────┐
 Jira Story ──►  fetch-jira.js ──► docs/tickets/<KEY>.md (+ attachments/screenshots)
                          │
                          ├──[AI, sonnet]──► /summarize-story ──► <KEY>.summary.json (~30k token)
                          │
                          └──[AI, opus]────► /analyze-story (phát hiện Blocker/Conflict)
                                                   │
                                                   └──► /new-test ──► TC-<KEY>.md + POM + .spec.ts
                    └───────────────────────────────────────────────────────────────┘

                    ┌─────────────────── GIAI ĐOẠN 2: RECORD ─────────────────────┐
 record-ticket.js ─► Layer 1 DOM Annotator (data-stable-label) + Layer 2 PrimeFaces
                     Capture Bridge ─► tests/recordings/<KEY>.recording.ts
                    └───────────────────────────────────────────────────────────────┘

                    ┌─────────────── GIAI ĐOẠN 3: SINH & ĐỒNG BỘ CODE ────────────┐
 sync-specs.js ──► Reverse-Grounding (live_grounded_components.yaml)
                   + POM (extractPomModel) + starter .spec.ts
 md-to-spec.js ──► Biên dịch TC-<KEY>.md (khối ```automation```) → .spec.ts (0 token)
                    └───────────────────────────────────────────────────────────────┘

                    ┌────────── GIAI ĐOẠN 4: THỰC THI & TỰ CHỮA LÀNH ─────────────┐
 run-function.js (Mode 1, 0 token) ─┐
 run-agent.js    (Mode 2, AI rescue)├─► FAIL ─► ai-healer.js (Mode 3)
 smart-action.ts ─► last-failure-context.json     tsc guard + auto-REVERT + retest loop
                    └───────────────────────────────────────────────────────────────┘
```

**Điểm mấu chốt cần ghi nhận:** `auto-test.js` (pipeline A) và `ticket-pipeline.js` (pipeline B) đều gọi `fetch-jira` và đều chạy Playwright, nhưng bước giữa (sinh spec) hoàn toàn khác nhau. Chúng chỉ được "khâu lại" một cách lỏng lẻo qua cờ `--ground` / `--regenerate` và cơ chế reverse-grounding.

---

## 3. Đánh Giá Chi Tiết Theo Từng Giai Đoạn

### 🟦 Giai đoạn 1 — Đọc Story & Sinh Testcase Gợi Ý (`fetch-jira.js` + prompts)

**Điểm mạnh (rất tốt):**
- **Fetch đa tầng thông minh:** `fetch-jira.js` thử CDP (Chrome đang mở) → persistent profile, dùng vòng lặp chống đóng sớm (anti-premature-close), phân biệt trang SSO Microsoft với trang Jira thật (không dựa vào `key` trong URL redirect). Bóc tách qua **REST API trước, DOM scrape fallback** — rất bền.
- **Đa nguồn đặc tả:** Không chỉ Description/AC, mà còn tải **attachments/mockup** (lọc rác icon <50KB) và **Jira Comments** như *"Resolution Authority"* — nhận diện các quyết định PO/Dev chốt sau AC gốc. Đây là tư duy nghiệp vụ QA rất chín.
- **Phân tầng model tối ưu chi phí:** `/summarize-story` (sonnet, rẻ) cô đọng ảnh + comment + YAML thành `summary.json` ~30k token; `/analyze-story` + `/new-test` (opus) chỉ nạp bản tinh gọn → giữ chi phí thấp mà vẫn suy luận sâu.
- **Cổng chất lượng Blocker/Conflict:** `/analyze-story` có checklist phát hiện xung đột chéo (Description ⇄ AC ⇄ codebase YAML ⇄ ảnh), đặc biệt quy tắc **"đếm số task/step lệch nhau = BLOCKER"**. Khi Blocker → **dừng, xuất Bảng Câu Hỏi gửi PO**, thoát mã lỗi riêng (exit code 2) để CI phân biệt với crash. Đây là điểm sáng chống "sinh test mù".

**Điểm nghẽn / Lỗ hổng:**
- **G1.1 — Grounding dựa trên YAML tĩnh dễ trôi (drift).** `ui_components.yaml`/`state_machine.yaml` sinh bởi `generate-codebase-specs`. Nếu app đổi mà chưa regenerate, `/analyze-story` có thể báo Blocker giả hoặc bỏ sót field thật. Không có cơ chế cảnh báo YAML đã cũ.
- **G1.2 — Phụ thuộc chất lượng multimodal của model.** Bước "quan sát ảnh mockup bằng mắt" là bắt buộc nhưng **không có kiểm chứng tự động** rằng model đã thực sự đọc ảnh; nếu model bỏ qua, cả chuỗi phát hiện xung đột suy yếu âm thầm.
- **G1.3 — `docs/tickets/` hiện trống.** Trong repo **chưa có ticket Jira nào được fetch** và chỉ tồn tại đúng **1 function hoàn chỉnh** (`CREATE_RISK_REQUEST`, thuộc pipeline B). Nghĩa là **pipeline A (AI sinh test từ Story) gần như chưa được kiểm chứng thực chiến** trên ticket thật — rủi ro lý thuyết đẹp nhưng chưa "burn-in".

---

### 🟩 Giai đoạn 2 — Record Trên Giao Diện Thực Tế (`record-ticket.js`)

**Điểm mạnh (rất đáng giá cho PrimeFaces):**
- **Layer 1 — DOM Annotator:** gắn `data-stable-label` cho radio/checkbox, dọn class tạm (`ui-state-hover/active/focus`), đánh dấu link Axon Ivy ephemeral (`/faces/instances/`), theo dõi AJAX bằng `MutationObserver`. Ổn định locator **trước** khi recorder capture — version-agnostic.
- **Layer 2 — PrimeFaces Capture Bridge:** giải quyết đúng nỗi đau kinh điển: overlay dropdown `selectOneMenu` bị PrimeFaces detach/hide ngay trong cùng cú click nên Codegen bỏ sót. Bridge chạy ở **capture phase**, `keepAlive` panel để click được ghi lại, gắn `role="option"` để sinh `getByRole('option')` semantic.

**Điểm nghẽn / Lỗ hổng (đây là khu vực giòn nhất):**
- **G2.1 — Dùng API nội bộ Playwright `context._enableRecorder(...)`.** Đây là **API private, không ổn định**; nâng cấp Playwright có thể phá vỡ recorder. Rủi ro bảo trì cao.
- **G2.2 — Annotator chỉ thêm attribute, KHÔNG ép Codegen dùng nó.** `data-stable-label`/`data-stable-marker` là metadata; Codegen vẫn tự do sinh `getByRole`/CSS theo ý nó. Mối liên kết giữa "annotate" và "selector cuối cùng" **không được đảm bảo** — công sức Layer 1 có thể bị Codegen phớt lờ.
- **G2.3 — Nhãn radio/checkbox có thể bị chọn nhầm.** Fallback lấy `label` đầu tiên trong container → nhiều option cùng nhận một nhãn.
- **G2.4 — Bao phủ PrimeFaces chưa đủ.** Bridge tập trung `selectOneMenu`; **bỏ sót** `selectCheckboxMenu`, autocomplete, date/time picker, tree/table selection. Timeout fallback 1.2s có thể release panel trước khi click được ghi.
- **G2.5 — Rác tạm & session.** File `.playwright-recorder-launcher.tmp.js` tạo ở root, nếu process bị kill sẽ còn sót. Nếu Tester login tay giữa chừng, script **không tự lưu** storage state (chỉ nhắc `npm run login`).

---

### 🟨 Giai đoạn 3 — Sinh & Đồng Bộ Mã Nguồn (`sync-specs.js`, `md-to-spec.js`)

**Điểm mạnh:**
- **Reverse-Grounding — ý tưởng xuất sắc:** sau khi record, `sync-specs` bóc selector thật vào `live_grounded_components.yaml` với `origin: live_recording_<KEY>` → ticket sau tự tái dùng "tri thức sống". Merge theo `key` (không nhân bản), xử lý URL ephemeral Axon Ivy.
- **POM có luật thực chiến:** ưu tiên click `<label>` cho radio/checkbox PrimeFaces, `.filter({visible:true}).first()` cho Next/Submit, chuyển ID ephemeral thành regex ổn định, chống strict-mode. Mặc định **không ghi đè** POM/spec (cần `--force-pom`/`--force-spec`) — bảo vệ sửa tay.
- **`md-to-spec.js` — cầu nối "Tester không cần biết code":** DSL Markdown (khối ` ```automation `) hỗ trợ `fill/expect/wait/pause/goto/include`, Given/When/Then → `test.step`. **POM Introspection** đối chiếu method/member với Page Object → **bắt lỗi gõ sai ngay, không ghi spec nửa vời**. **Scenario Inheritance** (`include TC-...-01`) tái dùng 90% flow. 0 token, ~0.2s — rất thân thiện.

**Điểm nghẽn / Lỗ hổng:**
- **G3.1 — Parser bằng regex/text, KHÔNG phải AST TypeScript.** Cả `sync-specs` lẫn `md-to-spec` đọc code bằng regex. Dễ vỡ với: locator nhiều dòng, chain `.filter()/.nth()/.first()`, argument không phải literal, comment chứa pattern giống action. Đây là **nợ kỹ thuật nền tảng** — mọi tính năng cao cấp phía trên đứng trên nền regex giòn.
- **G3.2 — Hai bộ trích xuất KHÔNG đồng bộ.** YAML dùng `extractComponents()`, POM dùng `extractPomModel()` — hai logic khác nhau trên cùng recording. Hệ quả: component có trong YAML nhưng không sinh được POM, hoặc selector YAML ≠ selector POM cuối cùng → **"grounding source" và artefact chạy được lệch nhau**.
- **G3.3 — Luật nghiệp vụ hard-code trong generator.** Tên `OK/Next/Submit/Save/Cancel`, rating, task-ID Axon Ivy bị nhúng cứng → khó tái dùng cho dự án/ngôn ngữ khác; method name phụ thuộc text UI (đổi ngôn ngữ → đổi tên method).
- **G3.4 — POM Introspection chỉ kiểm tên, không kiểm chữ ký/kiểu.** Gọi đúng tên method nhưng sai số/loại tham số vẫn lọt; không kiểm method kế thừa từ base class, không xác thực selector tồn tại runtime.
- **G3.5 — `include` chỉ trong cùng file, không tham số hoá.** Không include file ngoài, không truyền data/biến vào scenario cha → tái dùng cứng nhắc.

---

### 🟥 Giai đoạn 4 — Thực Thi & Tự Chữa Lành (`run-function.js`, `run-agent.js`, `ai-healer.js`)

**Điểm mạnh:**
- **3 Mode phân tầng hợp lý:** Mode 1 deterministic 0 token (CI/regression), Mode 2 POM-first + AI rescue khi 1 bước fail (không để AI viết cả flow — giảm rủi ro), Mode 3 offline self-heal có guardrail.
- **SSO/MFA hand-off thực chất** (trong `run-agent.js`): phát hiện URL SSO, chờ Tester làm MFA (timeout 120s, poll 1.5s), **lưu lại `.auth/user.json`** cho lần sau.
- **Guardrail chữa lành đáng khen:** `ai-healer.js` chạy `tsc --noEmit` **baseline trước** và **sau mỗi round**; nếu AI gây lỗi biên dịch mới → **tự REVERT** từ backup in-memory. Vòng lặp `MAX_HEAL_ROUNDS` (mặc định 3) có giới hạn, feedback round trước đưa vào round sau. Bảo vệ ground truth: **không auto-fill mặc định** (chỉ khi `--heal`).
- **`smart-action.ts`** dump `last-failure-context.json` (selectorTried, tracePath, screenshot, frameUrl) — nguồn chẩn đoán có cấu trúc cho healer.

**Điểm nghẽn / Lỗ hổng (quan trọng nhất về AN TOÀN):**
- **G4.1 — 🔴 AI CLI chạy với quyền cực rộng.** Cả `run-agent.js` và `ai-healer.js` gọi CLI với `--allow-all` / `--dangerously-skip-permissions`. **Không có** file allowlist, diff approval, hay sandbox. Prompt nói "chỉ sửa POM" nhưng **không có gì ép buộc** — AI có thể sửa file khác. Đây là rủi ro lớn nhất khi đưa vào vận hành thật.
- **G4.2 — `tsc --noEmit` KHÔNG đủ chứng minh patch an toàn.** Guardrail chỉ chặn lỗi *biên dịch*, không chặn: logic sai, selector sai vẫn compile, hoặc **AI làm yếu/xoá assertion để "ép xanh"**. Nếu baseline đã có lỗi tsc sẵn thì cơ chế revert bị vô hiệu.
- **G4.3 — Coupling giòn của vòng self-heal.** `last-failure-context.json` **chỉ được sinh nếu POM/spec dùng helper `smartAction`**. Spec do **AI (pipeline A) sinh có thể KHÔNG dùng `smartAction`** → healer chạy **mù** hoặc đọc **context cũ (stale)** của run trước → chữa theo lỗi sai. `run-function.js` và `ai-healer.js` đều không tự sinh file này.
- **G4.4 — Pass/Fail chỉ dựa vào exit code Playwright.** Thiếu assertion nghiệp vụ độc lập. Đặc biệt Mode 2: nếu happy path không throw thì coi là PASS dù AI rescue có thể đã click nhầm phần tử. Retest trong healer **không truyền lại** `-g`/`--debug`/`--slowmo` của lần fail gốc → không tái hiện đúng điều kiện.
- **G4.5 — "Offline" gây hiểu nhầm.** `ai-healer.js` vẫn gọi Copilot/Claude CLI (cần mạng/quota). Fallback CLI có thể nhân đôi token/thời gian. Prompt gửi absolute path + lỗi UI ra CLI → nguy cơ lộ dữ liệu nội bộ.
- **G4.6 — `shell: true` trên Windows.** `runTsc()` và một số spawn dùng `shell:true`; dù đã quote, vẫn là bề mặt rủi ro nếu tham số đến từ nguồn không tin cậy.

---

## 4. Trả Lời Trực Tiếp 3 Câu Hỏi Của Sếp

### ❓ Đâu là điểm mượt mà?
1. **Fetch Jira + tải mockup/comment** — gần như không cần Tester can thiệp, chống SSO tốt.
2. **Phân tầng model tối ưu chi phí** (summarize rẻ → analyze/generate mạnh → run 0 token).
3. **`md-to-spec` + POM Introspection** — Tester sửa kịch bản bằng Markdown, bắt lỗi tức thì, 0 token: trải nghiệm mượt nhất hệ thống.
4. **Reverse-Grounding** — càng dùng càng "biết" app, ticket sau đỡ đoán hơn ticket trước.
5. **Guardrail tsc + auto-REVERT** — chữa lành có phanh an toàn.

### ❓ Đâu là bước gượng gạo / dễ lỗi / cần can thiệp tay không cần thiết?
1. **Record (Giai đoạn 2)** — giòn nhất: phụ thuộc API private Playwright, annotator không ép được selector, bỏ sót nhiều widget PrimeFaces (multiselect, datepicker, autocomplete). Tester thường phải **record lại** khi AJAX timing làm mất thao tác.
2. **Nền parser regex (Giai đoạn 3)** — mọi thứ đứng trên regex; recording phức tạp → POM/spec sai âm thầm, Tester phải dò tay.
3. **Chọn nhầm pipeline** — Tester phải tự biết khi nào dùng `auto-test` (A) vs `ticket` (B) vs `record:function`. Không có "một cửa" rõ ràng cho ticket mới.
4. **Chẩn đoán khi self-heal chạy mù** (G4.3) — khi thiếu `last-failure-context.json`, Tester phải tự mở trace/screenshot.

### ❓ Có mâu thuẫn / lệch pha giữa AI-sinh-từ-Story và Record thực tế không? — **CÓ, và đã được ghi nhận nội bộ.**
Đây là **vấn đề trung tâm**, được chính team phân tích trong `docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md`:
- **Nguồn gốc (R1+R2):** Pipeline A tối ưu token bằng cách **tách AI khỏi app thật** → AI sinh test *chỉ từ chữ* → **đoán** selector/text/số phần tử → **fail liên tục**. Trong khi Record (pipeline B) cho AI/parser **thấy DOM thật** → bám thực tế → hiệu quả hơn. Chính là cảm giác *"testcase rời xa thực tế hơn prompt"*.
- **Đã vá một phần:** thêm cờ `--ground` (bắt buộc recording làm Grounding Truth ưu tiên cao nhất trong prompt `/new-test`), `--regenerate`, reverse-grounding, và **Baseline Gate** trong `/fix-failed-test` (test *chưa từng xanh* = lỗi tác giả, **không** vội quy "bug web").
- **Còn tồn đọng:** hai pipeline **vẫn chưa hợp nhất**. `--ground` là *tuỳ chọn*, không *mặc định* — nên nếu Tester quên record trước, pipeline A lại rơi về chế độ "đoán". Reverse-grounding giúp ticket-sau nhưng **không cứu ticket-đầu-tiên** của một màn hình mới.

---

## 5. Khuyến Nghị Cải Tiến (Ưu Tiên Theo Tác Động)

### 🔴 Ưu tiên CAO — An toàn & Hợp nhất luồng

| # | Khuyến nghị | Giải quyết | Nỗ lực |
|---|---|---|---|
| **R1** | **Hợp nhất thành 1 luồng "Grounding-First" mặc định.** Với ticket mới: bắt buộc `fetch → record (grounding) → AI generate grounded → run`. Biến `--ground` thành **hành vi mặc định**, chỉ cho phép "no-ground" khi Tester chủ động chọn (kèm cảnh báo test sẽ là draft `// ⚠️ CHƯA GROUNDED`). | Lệch pha AI vs Record (G-core) | Trung bình |
| **R2** | **Siết quyền AI khi sửa code.** Thay `--allow-all`/`--dangerously-skip-permissions` bằng: (a) chạy healer trên **git branch/worktree riêng**, (b) **diff review gate** trước khi apply, (c) **file allowlist** (chỉ `tests/pages/**`, `tests/e2e/**`). | G4.1 | Trung bình |
| **R3** | **Bổ sung "assertion gate" ngoài exit code.** Sau heal/rescue, so `git diff` để **chặn AI xoá/làm yếu assertion** (`toBe*`, `expect`); nếu assertion giảm → coi là fail, không PASS. | G4.2, G4.4 | Thấp |
| **R4** | **Đảm bảo `last-failure-context.json` luôn được sinh.** Ép mọi spec (kể cả AI-gen) đi qua `smartAction`, hoặc thêm Playwright **reporter/global-teardown** tự dump failure context độc lập; healer phải **kiểm timestamp** để từ chối context stale. | G4.3 | Thấp |

### 🟠 Ưu tiên TRUNG BÌNH — Độ bền kỹ thuật

| # | Khuyến nghị | Giải quyết | Nỗ lực |
|---|---|---|---|
| **R5** | **Thay regex parser bằng AST** (TypeScript Compiler API / `@babel/parser`) cho `sync-specs` và `md-to-spec`; hợp nhất `extractComponents` và `extractPomModel` thành **một bộ trích xuất duy nhất**. | G3.1, G3.2 | Cao |
| **R6** | **Mở rộng Capture Bridge** cho `selectCheckboxMenu`, autocomplete, datepicker, tree/table; **pin phiên bản Playwright** và bọc `_enableRecorder` sau một lớp adapter có test hồi quy để cảnh báo sớm khi API private đổi. | G2.1, G2.4 | Cao |
| **R7** | **Cảnh báo YAML grounding cũ.** `generate-codebase-specs` ghi hash/commit nguồn; `/analyze-story` cảnh báo nếu YAML cũ hơn code hiện tại (chống Blocker giả). | G1.1 | Thấp |
| **R8** | **Tách luật nghiệp vụ ra config.** Chuyển các tên hard-code (`OK/Next/Save`, task-ID) sang file `config/selector-rules.json` để tái dùng đa dự án/đa ngôn ngữ. | G3.3 | Thấp |

### 🟡 Ưu tiên THẤP — Trải nghiệm & Vệ sinh

- **R9 — Một cửa cho Tester:** một lệnh `npm run qa <KEY>` như wizard hỏi *"Ticket mới hay chạy lại? Đã record chưa?"* rồi tự chọn đúng nhánh — Tester không phải nhớ 3–4 lệnh.
- **R10 — Dọn rác & session:** tự xoá `.playwright-recorder-launcher.tmp.js` kể cả khi crash; tự lưu storage state nếu phát hiện Tester đã login tay trong lúc record.
- **R11 — Đổi tên "Offline" self-heal** → "Local-run AI self-heal" để tránh hiểu nhầm là không cần mạng/quota.
- **R12 — Burn-in pipeline A:** chạy thử pipeline `auto-test` trên **3–5 ticket Jira thật** để kiểm chứng thực chiến (hiện `docs/tickets/` đang trống, chỉ 1 function record-driven tồn tại).

---

## 6. Lộ Trình Đề Xuất (Roadmap)

- **Sprint 1 (An toàn — bắt buộc trước khi mở rộng):** R2, R3, R4 — không để AI sửa code không kiểm soát; đảm bảo vòng self-heal có dữ liệu thật.
- **Sprint 2 (Hợp nhất luồng):** R1, R9 — một luồng Grounding-First, một cửa cho Tester; R12 burn-in trên ticket thật.
- **Sprint 3 (Độ bền nền tảng):** R5, R6 — thay regex→AST, mở rộng Capture Bridge, pin Playwright.
- **Sprint 4 (Đánh bóng):** R7, R8, R10, R11.

---

## 7. Kết Luận

Đây là một dự án automation **có chiều sâu tư duy vượt mức trung bình**: nó không chỉ "chạy Playwright" mà đã giải quyết đúng các nỗi đau thật của Axon Ivy/PrimeFaces (ID động, overlay AJAX), có triết lý grounding chống-đoán, phân tầng chi phí AI thông minh, và **đã tự nhận diện** điểm yếu cốt lõi của chính mình (testcase-vs-reality).

**Hai việc cần làm để nâng từ "khung tốt" lên "sản xuất tin cậy":**
1. **Hợp nhất hai pipeline** thành một luồng Grounding-First mặc định — xoá tận gốc sự lệch pha AI-vs-Record.
2. **Đặt phanh an toàn cho AI sửa code** (branch cô lập + diff gate + assertion gate + file allowlist) — vì `tsc` một mình không đủ.

Khi hai việc này hoàn tất, trải nghiệm Tester xử lý một ticket mới sẽ thực sự đạt đúng khẩu hiệu của dự án: **"Record → Run → Self-Heal — một lệnh, bám thực tế, không đoán mò."**

---
*Báo cáo tự động bởi GitHub Copilot CLI. Tham chiếu mã nguồn: `scripts/*.js`, `.github/prompts/*.prompt.md`, `docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md`, `tests/support/smart-action.ts`.*
