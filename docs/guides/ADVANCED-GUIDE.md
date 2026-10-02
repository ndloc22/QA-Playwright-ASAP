# 📚 Advanced Guide — QA Playwright Copilot Starter Kit

Tài liệu chi tiết cho các cơ chế nâng cao. `README.md` ở thư mục gốc là bản hướng dẫn ngắn gọn (Quick Start 3 bước); file này giữ phần chi tiết kỹ thuật để tra cứu khi cần.

> Starter kit này **không khóa cứng vào nghiệp vụ nào**. Mọi ví dụ dùng mã ticket chung `TICKET-123`; thay bằng mã ticket thật của bạn và trỏ `BASE_URL` sang app của bạn.

---

## 1. Spec-Driven Testing — Bộ OpenSpecs nghiệp vụ (`docs/specs/`)

Đọc thẳng toàn bộ tài liệu nghiệp vụ vào AI rất tốn token và dễ nhiễu. Starter kit nén chúng thành **bộ đặc tả OpenSpec máy đọc được** (YAML):

| File | Nội dung nén |
| --- | --- |
| `docs/specs/index.yaml` | Điểm vào định tuyến + mã khóa nghiệp vụ (template — điền theo dự án của bạn) |
| `docs/specs/process.yaml` | Các bước quy trình, trạng thái, REST, điều kiện rẽ nhánh |
| `docs/specs/roles.yaml` | Role concept, ma trận visible/editable theo vai trò |
| `docs/specs/fields.yaml` | Từ điển trường dữ liệu (format, enum) + mapping DB |

> `index.yaml` ship sẵn dưới dạng **template generic**. Thay phần mô tả placeholder bằng spec nghiệp vụ thật của bạn (cô đọng từ tài liệu yêu cầu), giữ nguyên khối `codebase_specs` (do tooling tự sinh).

**Mức tiết kiệm token:** tra cứu theo **từng ticket** (đọc `index.yaml` + grep đúng 1 mục spec) cắt >95% token so với nạp cả tài liệu gốc.

### Cách dùng khi viết testcase
1. Xác định **ticket** hoặc bước nghiệp vụ đang kiểm thử.
2. Mở `docs/specs/index.yaml` để định tuyến sang spec con phù hợp.
3. Dùng grep trong `docs/specs/`:
   - Bước/trạng thái/REST/rẽ nhánh → `process.yaml`.
   - Vai trò/quyền hiển thị-sửa → `roles.yaml`.
   - Trường dữ liệu & mapping DB → `fields.yaml`.
4. Chỉ mở tài liệu gốc khi cần chi tiết mà spec chưa có — mỗi mục spec nên có trường `src:` chỉ đúng file nguồn.

### Kiểm tra YAML hợp lệ sau khi sửa spec
```bash
python -c "import yaml,glob; [yaml.safe_load(open(f,encoding='utf-8')) for f in glob.glob('docs/specs/*.yaml')]"
```

---

## 2. Bóc tách Ticket tự động (`docs/tickets/`)

### Cách 1: 1-Click Chrome Bookmarklet
1. Mở trang bookmarklet đi kèm và kéo nút sync thả vào Bookmark Bar (xem `scripts/bookmarklet-code.txt` / `scripts/jira-sync-bookmarklet.js`).
2. Khi đang xem một ticket bất kỳ trên hệ ticketing của bạn, click nút bookmarklet.
3. Summary, Description, AC, Sprint, Story Points được lưu ngay vào `docs/tickets/<KEY>.md` và `docs/tickets/<KEY>.json`.

### Cách 2: Playwright Browser Automation
```bash
npm run fetch-ticket TICKET-123
# hoặc:
npm run fetch-ticket https://your-jira/browse/TICKET-123
```
Playwright tự bật trình duyệt với Persistent Session (`.auth/`), bóc tách dữ liệu qua REST API và lưu vào `docs/tickets/TICKET-123.md`.

### Tự động tải ảnh/attachment + chụp diagram (Multimodal-ready)
`fetch-jira.js` còn tự động:
- Quét mọi `<img>` và link attachment, **tải file nhị phân thật** vào `docs/tickets/<KEY>/attachments/`.
- Chụp riêng từng **diagram nhúng** (draw.io, gliffy, canvas, iframe) vào `docs/tickets/<KEY>/screenshots/diagram-N.png`.
- Chụp 1 ảnh **full-page** làm bằng chứng (`docs/tickets/<KEY>/screenshots/full-page.png`).
- **Nhúng sẵn đường dẫn ảnh tương đối** vào `docs/tickets/<KEY>.md`.

> `fetch-jira.js` mặc định nhắm hệ Jira. Nếu bạn dùng hệ ticketing khác, điều chỉnh selector/endpoint trong script cho phù hợp.

---

## 3. Grounding & Reverse-Grounding chi tiết

### Ghi hình Grounding Truth (`npm run record:ticket <KEY>`)
- Đọc `BASE_URL` trực tiếp từ `.env` (cùng nguồn với `playwright.config.ts`).
- Tự nạp session đăng nhập từ `.auth/user.json` (`--load-storage`) — Tester vào thẳng app đã đăng nhập. Nếu file này chưa có, script cảnh báo và mở trình duyệt chưa đăng nhập.
- Mở `npx playwright codegen --target=playwright-test`, ghi lại chính xác selector/flow.
- Xuất kết quả: `tests/recordings/<KEY>.recording.ts`.
- Mở sâu vào 1 màn hình cụ thể: `npm run record:ticket TICKET-123 -- --url /path/to/screen`.

### `regenerate` khác `auto-test` thế nào?
`regenerate` chạy lại **đúng Bước `[3/4]` + `[4/4]`** (sinh Page Object/Test Spec + verify), **bỏ qua** Bước `[1/4]` (fetch ticket) và `[2/4]` (summarize) vì ticket đã đồng bộ từ trước — nhanh và rẻ hơn khi chỉ cần regenerate sau khi ghi hình.

Khi chạy `regenerate` (hoặc `auto-test`), nếu phát hiện `tests/recordings/<KEY>.recording.ts` tồn tại, pipeline **tự động**:
1. Nạp nội dung recording vào prompt gửi `/new-test`, đánh dấu là **Grounding Truth ưu tiên cao nhất** — cao hơn `ui_components.yaml`/`state_machine.yaml`.
2. Sinh Page Object + Test Spec dùng đúng selector đã ghi nhận.
3. **Tự động gỡ `test.fixme(...)`** khỏi các test case ứng với flow đã có trong recording. Các flow chưa ghi hình vẫn giữ `test.fixme(...)`.

Bắt buộc phải có recording trước khi generate — thêm cờ `--ground`:
```bash
npm run auto-test TICKET-123 -- --ground
# hoặc:
node scripts/auto-test.js TICKET-123 --regenerate --ground
```

### Reverse-Grounding (`npm run sync-specs`)
Grounding là 1 chiều (OpenSpecs/recording → sinh test). **Reverse-Grounding** đóng vòng lặp ngược lại: bóc tách selector/component **thực tế** trong `tests/recordings/<KEY>.recording.ts` rồi **merge ngược vào OpenSpecs**, để bộ spec **tích luỹ tri thức sống** — ticket mới sau này tái sử dụng ngay selector đã kiểm chứng.

**Cơ chế:**
- `scripts/sync-specs.js` phân tích recording, trích xuất `getByRole`/`getByLabel`/`getByPlaceholder`/`getByText`/`getByTestId`/`getByTitle`/`getByAltText`, `page.locator('css')`, và **client id kiểu naming-container** (vd `form:saveButton`), kèm **actions** và **sampleValues**.
- Kết quả **merge an toàn** vào `docs/specs/codebase/live_grounded_components.yaml`, mỗi component đánh dấu `origin: live_recording_<KEY>`. Merge theo KEY (idempotent).
- File này KHÔNG đụng tới `ui_components.yaml`/`state_machine.yaml`. `index.yaml` và `new-test.prompt.md` ưu tiên file live này cao hơn spec tĩnh.

```bash
# Tự động: mỗi lần auto-test/regenerate có recording hợp lệ, pipeline tự sync ngược sau bước [3/4].
npm run regenerate TICKET-123

# Thủ công: sync 1 ticket, hoặc toàn bộ recording đang có
npm run sync-specs TICKET-123
npm run sync-specs -- --all
```
Recording chỉ có điều hướng (không click/fill) sẽ bị bỏ qua để tránh làm "ô nhiễm" OpenSpecs.

---

## 4. Kiến trúc phân tầng model (`npm run auto-test <KEY>`)

Pipeline chạy trọn gói **4 bước tự động, phân tầng theo model AI**:

| Bước | Việc làm | Model / Engine | Vì sao |
| :-: | --- | --- | --- |
| `[1/4]` | 📥 Ingest ticket + tải ảnh/diagram (`fetch-jira.js`) | **0 token** (browser scraping) | Không cần AI, chỉ scrape DOM |
| `[2/4]` | 🧾 `/summarize-story`: đọc ticket + ảnh + Comments + đối chiếu `docs/specs/codebase/` → `docs/tickets/<KEY>.summary.json` | **`claude-sonnet-5`** | Trích xuất/đọc không đòi hỏi suy luận sâu — model rẻ hơn |
| `[3/4]` | 🤖 `/analyze-story` (giải quyết conflict) + `/new-test` (test matrix + sinh `.spec.ts`) — đọc `summary.json` | **`claude-opus-4.8`** (mặc định) | Tận dụng chiều sâu suy luận Opus trên bản tóm tắt tinh gọn (~30k tokens) |
| `[4/4]` | 🧪 Chạy `npx playwright test` verify | **0 token** (Playwright local) | Thực thi test không cần AI |
| *(nếu FAIL)* | 🩺 Self-healing: `/fix-failed-test` chẩn đoán + tự sửa hoặc xuất Bug Report, rồi re-run 1 lần | **`claude-sonnet-5`** | Chẩn đoán lỗi kỹ thuật không cần mức suy luận cao nhất |

**Override model:**
```bash
npm run auto-test TICKET-123 -- --sonnet
npm run auto-test TICKET-123 -- --model claude-sonnet-5
```
Thứ tự ưu tiên: cờ dòng lệnh > biến môi trường (`AUTO_TEST_SUMMARY_MODEL`, `AUTO_TEST_ANALYSIS_MODEL`, `AUTO_TEST_SELF_HEAL_MODEL`) > mặc định `claude-opus-4.8`.

### Chạy từng bước qua Copilot Chat
Dùng khi muốn kiểm soát từng bước, xem kỹ kết quả `/analyze-story` trước khi sinh spec.

**Bước 0 (tùy chọn): `/summarize-story`** — cô đọng ticket nhiều ảnh/comment thành `summary.json` (model `claude-sonnet-5`).

**Bước 1: `/analyze-story`** — đối chiếu Description ⇄ AC ⇄ codebase specs ⇄ ảnh (model `claude-opus-4.8`):
- 🔴 **Blocker** → dừng, xuất bảng câu hỏi gửi PO, chưa sinh spec.
- 🟡 **Warning** → cho sang bước 2, test sinh ra có `// ⚠️ ASSUMPTION:`.

**Bước 2: `/new-test`** — sinh `tests/testcases/TC-<KEY>.md` + `tests/e2e/TC-<KEY>.spec.ts` (model `claude-opus-4.8`).

**Bước 3: verify** — `npx playwright test tests/e2e/TC-<KEY>.spec.ts`.

**Bước 4 (nếu FAIL): `/fix-failed-test`** — tự chẩn đoán/sửa (model `claude-sonnet-5`).

---

## 5. Bộ bóc tách OpenSpecs Codebase (`docs/specs/codebase/`)

Bộ đặc tả bóc tách **trực tiếp từ mã nguồn ứng dụng thật**, giúp Copilot lấy selector/state-machine chuẩn xác thay vì suy đoán:

| File | Nội dung |
| --- | --- |
| `ui_components.yaml` | Từng dialog/màn hình: tên, đường dẫn, component (id, type, label, required, value binding) |
| `state_machine.yaml` | Từng process: task, `responsibleRole`, transition + điều kiện rẽ nhánh |
| `live_grounded_components.yaml` | **(Reverse-Grounding)** Selector/component thật bóc tách ngược từ `npm run record:ticket`. Mỗi entry có `origin: live_recording_<KEY>`; ưu tiên cao hơn `ui_components.yaml`. Tự sinh, không commit sẵn. |

### Sinh lại OpenSpecs (khi codebase ứng dụng thay đổi)
```bash
npm run generate-codebase-specs
# hoặc chỉ định nguồn khác:
node scripts/generate-codebase-specs.js --source "D:\Projects\<your-app-source>"
```
Script quét **READ-ONLY** mã nguồn (mặc định nhắm dạng `*.xhtml` + `*.p.json` của Axon Ivy — điều chỉnh trong script nếu app của bạn dùng công nghệ khác), không ghi gì vào dự án nguồn.

---

## 6. Quy trình xử lý Blocker & Open Questions (2 Giai đoạn)

Khi `/analyze-story` phát hiện **Blocker**, story **KHÔNG được** sinh `.spec.ts` cho tới khi PO/BA chốt phương án.

### 🚩 Giai đoạn 1 — Khi phát hiện Blocker
1. **Dừng sinh mã `.spec.ts`** ngay lập tức.
2. **Xuất Bảng Câu Hỏi chuẩn 4 cột** gửi PO/BA:

   | Vị trí xung đột | Bản chất xung đột | Câu hỏi chốt phương án cho PO | Tác động kiểm thử |
   | --- | --- | --- | --- |
   | (VD: AC #3 vs `state_machine.yaml`) | (Mô tả ngắn gọn) | (Câu hỏi Yes/No hoặc chọn A/B) | (Test nào bị chặn nếu không làm rõ) |

3. **Lưu vết local**: ghi Bảng Câu Hỏi vào `docs/tickets/<KEY>.md`, mục `## 🔴 Open Questions & Blockers`.
4. **Thông báo người chốt**: comment nguyên văn lên ticket và/hoặc kênh chat. **Không tự suy đoán** thay PO.

> ⛔ Pipeline `npm run auto-test <KEY>` sẽ dừng đúng quy trình (exit code 2), in Bảng Câu Hỏi ra terminal.

### ✅ Giai đoạn 2 — Sau khi PO/BA phản hồi
1. **Cập nhật Single Source of Truth** trước tiên:
   - PO sửa trực tiếp trên ticket → `npm run fetch-ticket <KEY>` để re-sync.
   - PO chốt qua comment/chat → ghi nguyên văn vào `docs/tickets/<KEY>.md`.
2. **Chạy lại `/analyze-story`** để xác nhận Clear Gate. Nếu còn mâu thuẫn → quay lại Giai đoạn 1.
3. **Chạy `/new-test`** để sinh testcase + spec.
4. **Cập nhật Page Object** nếu story phát sinh task/dialog/component mới.
5. **Verify & smoke test**: `npx playwright test tests/e2e/TC-<KEY>.spec.ts`. Nếu FAIL → `/fix-failed-test`.
6. **Commit và bàn giao** ticket, testcase, spec, Page Object liên quan.

> 💡 **Giai đoạn 1 = Dừng đúng lúc** (bảo vệ chất lượng), **Giai đoạn 2 = Đồng bộ nguồn chân lý trước khi sinh lại**.

---

## 7. Nhân bản Template sang dự án khác

Bộ khung tái sử dụng cho bất kỳ hệ thống web nào khác.

1. **Clone repo** làm điểm khởi đầu:
   ```bash
   git clone https://github.com/ndloc22/QA-Playwright-Copilot-Starter.git QA-Playwright-<YourApp>
   cd QA-Playwright-<YourApp>
   npm install
   ```
2. **Trỏ lại nguồn Codebase Specs** sang mã nguồn ứng dụng mới (nếu áp dụng):
   ```bash
   node scripts/generate-codebase-specs.js --source "D:\Projects\<your-app-source>"
   ```
3. **Thay `BASE_URL`** trong `.env` sang server test của bạn.
4. **Điền OpenSpecs nghiệp vụ** từ tài liệu yêu cầu của dự án — tham khảo cấu trúc `docs/specs/`.
5. **Xoá dữ liệu mẫu**: `docs/tickets/*`, spec/test demo (giữ lại nếu muốn làm ví dụ).
6. Prompt (`.github/prompts/*`) **giữ nguyên** — đây là phần logic tái sử dụng.

> Tách bạch **Prompts (logic tái sử dụng)** ⇄ **Specs/Tickets/Tests (dữ liệu đặc thù)** giúp nhân bản chỉ mất vài phút.
