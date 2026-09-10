# 🧪 QA Playwright Copilot Starter Kit — ASAP

### Bộ Khởi Động Kiểm Thử E2E theo Kiến Trúc **Testcase-First** + GitHub Copilot

> Từ 1 mã Ticket → testcase + Playwright spec hoàn chỉnh, **grounding vào DOM thật** (không đoán selector), chạy **1-Click** và tự chẩn đoán khi lỗi — tối ưu chi phí token AI.

<p align="left">
  <img alt="Playwright" src="https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white">
  <img alt="GitHub Copilot" src="https://img.shields.io/badge/GitHub%20Copilot-000000?logo=githubcopilot&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js%2020%2B-339933?logo=node.js&logoColor=white">
</p>

> 💡 Dự án kiểm thử tự động hóa E2E dành riêng cho team **ASAP**. Định dạng ticket mặc định là `ASAP-<ID>` (ví dụ `ASAP-101`), trỏ `BASE_URL` sang máy chủ test của dự án ASAP là dùng được ngay.

---

## 🧭 Bạn thuộc nhóm nào? (Đọc phần này trước)

Dự án phục vụ **2 nhóm người dùng** với mục đích khác nhau. Hãy xác định đúng nhóm của bạn để đi thẳng vào phần hướng dẫn phù hợp:

| Nhóm | Bạn là ai? | Bạn muốn làm gì? | Đi tới |
| :-: | --- | --- | --- |
| **1** | Làm việc với **Jira Ticket (ASAP)** | Sinh testcase + spec **tự động từ ticket** rồi kiểm chứng trên web thật | [→ Nhóm 1: Auto-Test từ Ticket](#-nhóm-1--người-làm-việc-với-jira-ticket) |
| **2** | Chỉ **chạy test có sẵn** | Chạy các test function/module **đã viết** và xem kết quả (không cần ticket) | [→ Nhóm 2: Chạy test có sẵn](#-nhóm-2--người-chỉ-chạy-test-có-sẵn) |

> ✅ **Cả 2 nhóm** đều cần làm [Cài Đặt](#-cài-đặt) + [Thiết Lập Môi Trường](#-thiết-lập-môi-trường) một lần duy nhất trước khi bắt đầu.

---

## ⚙️ Cài Đặt

```bash
git clone https://github.com/ndloc22/QA-Playwright-ASAP.git
cd QA-Playwright-ASAP
```

Rồi chạy cài đặt tự động (cài Node modules + Playwright browser):
- **🪟 Windows:** nhấp đúp **`setup-tester.bat`**
- **🍎 macOS / 🐧 Linux:** `./setup-tester.sh`

---

## 🌐 Thiết Lập Môi Trường

Tạo file `.env` (tham khảo `.env.example`) và trỏ `BASE_URL` sang ứng dụng bạn muốn kiểm thử:

```ini
# App under test (mặc định ví dụ: TodoMVC demo)
BASE_URL=https://demo.playwright.dev/todomvc

# Tài khoản đăng nhập (tùy chọn — chỉ khi app yêu cầu auth, dùng cho login & ghi hình)
TEST_USERNAME=your_username
TEST_PASSWORD=your_password
```

> 🔐 Session đăng nhập được lưu tại `.auth/user.json` để `record:ticket` vào thẳng app đã login, không phải re-login mỗi lần.

---

# 👥 Hướng Dẫn Sử Dụng Theo Nhóm Người Dùng

## 🎫 NHÓM 1 — Người làm việc với Jira Ticket

> **Mục tiêu:** Từ **1 mã ticket ASAP** → sinh ra testcase + Playwright spec hoàn chỉnh, bám selector DOM thật.
> **Yêu cầu:** đã cấu hình `.env` trỏ tới app test của team ASAP.

### Quy trình 3 bước chuẩn (mỗi ticket)

```bash
# 1️⃣ Sinh testcase & spec từ ticket (fetch → summarize → analyze → generate → verify)
npm run auto-test ASAP-101

# 2️⃣ Mở web thật, click qua đúng flow chính rồi đóng cửa sổ → tự xuất recording
npm run record:ticket ASAP-101

# 3️⃣ Regenerate: tự tham chiếu recording, gỡ test.fixme, đồng bộ OpenSpecs & verify test
npm run regenerate ASAP-101
```

| Bước | Lệnh | Kết quả sinh ra |
| :-: | --- | --- |
| 1 | `npm run auto-test <KEY>` | `tests/testcases/TC-<KEY>.md` + `tests/e2e/TC-<KEY>.spec.ts` (có `test.fixme`) |
| 2 | `npm run record:ticket <KEY>` | `tests/recordings/<KEY>.recording.ts` (DOM/selector thật) |
| 3 | `npm run regenerate <KEY>` | Spec bám selector thật, gỡ `test.fixme`, cập nhật OpenSpecs |

> 💡 Có thể thay `<KEY>` bằng link Jira đầy đủ: `npm run auto-test https://your-jira/browse/ASAP-101`.
> 💰 Ticket đơn giản → hạ tầng model cho rẻ: `npm run auto-test <KEY> -- --sonnet` (hoặc `--model claude-sonnet-5`).
> ⚡ Tạo luôn Jira Test Sub-task 0 token ngay khi sinh test: `npm run auto-test ASAP-101 -- --create-subtask`.

### Các lệnh phụ trợ cho Nhóm 1

| Lệnh | Công dụng |
| --- | --- |
| `npm run fetch-ticket <KEY>` | Bóc tách Jira ticket (text + ảnh + diagram) vào `docs/tickets/` |
| `npm run create-subtask <KEY> [KEY2 ...]` | **(0 token)** Tạo Jira Test Sub-task `Test in DEV <KEY>` (assign to me) qua REST API — hỗ trợ **multi-ticket** |
| `npm run sync-specs <KEY>` | Merge selector từ recording vào OpenSpecs (không ghi đè file đã có) |
| `npm run sync-specs <KEY> force` | **Ghi đè** cả POM lẫn spec ngay — không cần nhớ cú pháp `--` |
| `npm run sync-specs:force <KEY>` | Alias 1-click tương đương lệnh trên |
| `npm run generate-codebase-specs` | Bóc tách OpenSpecs từ mã nguồn ứng dụng (nếu có) |

> ✅ Sau bước 3, spec đã bám selector thật — **chuyển sang phần [Nhóm 2](#-nhóm-2--người-chỉ-chạy-test-có-sẵn) để chạy & xem kết quả test.**

---

## ▶️ NHÓM 2 — Người chỉ chạy test có sẵn

> **Mục tiêu:** Chạy các test function/module **đã có sẵn** trong `tests/e2e/` và xem kết quả — **không cần Jira ticket, không cần AI.**
> **Yêu cầu:** chỉ cần đã [Cài Đặt](#-cài-đặt).

### Lệnh chạy test cơ bản

| Lệnh | Công dụng |
| --- | --- |
| `npm test` | Chạy **toàn bộ** test **tuần tự** (1 worker — tránh xung đột session server) |
| `npm run test:headed` | Chạy test **có hiển thị trình duyệt** để quan sát trực tiếp |
| `npm run test:ui` | Mở **Playwright UI Mode** (tua thời gian, debug trực quan) |
| `npm run test:debug` | Chạy test ở chế độ **debug** (dừng từng bước) |
| `npm run report` | Mở **HTML report** + xem lại **video Full-HD 1080p** |
| `npm run clean` | Xóa sạch video & báo cáo cũ (`test-results/`, `playwright-report/`) |

### Chạy 1 test / 1 module cụ thể

```bash
# Chạy 1 file spec cụ thể
npx playwright test tests/e2e/TC-ASAP-101.spec.ts

# Chạy 1 test case theo mã hoặc tên (filter -g)
npx playwright test tests/e2e/TC-ASAP-101.spec.ts -g "01"

# Debug đúng 1 test case đó
npx playwright test tests/e2e/TC-ASAP-101.spec.ts -g "01" --debug
```

> 🖱️ **Trong VSCode:** bấm **`F5`** hoặc mở tab 🧪 **Testing** → nút ▶️ Play (hoặc 🐞 Debug từng test).

### Tùy chọn nâng cao khi chạy test

| Nhu cầu | Lệnh / Thiết lập |
| --- | --- |
| Chạy **song song** (chỉ khi test trên mock cục bộ) | `npm test -- --workers=4` |
| Xem video **chậm hơn** để thuyết trình | `set SLOWMO=800` rồi chạy test |
| Chạy **nhanh tối đa** (tắt giãn nhịp) | `set SLOWMO=0` rồi chạy test |

> 🎥 **Video tự động quay Full-HD (1920×1080)** cho **mọi** lần chạy (kể cả khi PASS). Nhịp thao tác mặc định **400 ms/bước** để tester xem lại rõ ràng. Xem lại bằng `npm run report`.

---

## 📋 Bảng Tra Cứu Toàn Bộ Lệnh (Cheatsheet)

| Lệnh | Nhóm | Công dụng |
| --- | :-: | --- |
| `npm run auto-test <KEY>` | 1 | Pipeline 4 bước: fetch ticket → summarize → analyze + generate → verify |
| `npm run regenerate <KEY>` | 1 | Regenerate spec từ recording (bỏ qua fetch/summarize), gỡ `test.fixme` |
| `npm run record:ticket <KEY>` | 1 | Mở web thật + codegen, ghi flow → `tests/recordings/<KEY>.recording.ts` |
| `npm run fetch-ticket <KEY>` | 1 | Bóc tách ticket (text + ảnh + diagram) vào `docs/tickets/` |
| `npm run create-subtask <KEY> [KEY2 ...]` | 1 | **(0 token)** Tạo Jira Test Sub-task `Test in DEV <KEY>` (assign to me) qua REST API |
| `npm run sync-specs <KEY>` | 1 | Merge selector từ recording vào OpenSpecs (không ghi đè) |
| `npm run sync-specs <KEY> force` | 1 | **Ghi đè** cả POM lẫn spec ngay |
| `npm run sync-specs:force <KEY>` | 1 | Alias 1-click tương đương lệnh trên |
| `npm run generate-codebase-specs` | 1 | Bóc tách OpenSpecs từ mã nguồn ứng dụng (nếu có) |
| `npm test` | 2 | Chạy toàn bộ test **tuần tự** (1 worker) |
| `npm test -- --workers=4` | 2 | Chạy song song (chỉ dùng trên mock server cục bộ) |
| `npm run test:headed` | 2 | Chạy test có hiển thị trình duyệt |
| `npm run test:ui` | 2 | Mở Playwright UI Mode |
| `npm run test:debug` | 2 | Chạy test ở chế độ debug |
| `npm run report` | 2 | Mở HTML report + xem lại video Full-HD 1080p |
| `npm run clean` | 2 | Xóa sạch video & báo cáo cũ |

---

## 🧠 Kiến Trúc Thông Minh (Tinh Gọn)

### OpenSpecs + Reverse-Grounding — tri thức sống tự học

Thay vì nạp toàn bộ tài liệu nghiệp vụ vào AI mỗi lần, starter kit nén nghiệp vụ thành **OpenSpecs** (YAML) và tự bồi đắp từ recording thật:

```
   Ticket ──────► fetch-ticket ──► docs/tickets/<KEY>.md (+ ảnh/diagram)
                                          │
                 OpenSpecs (docs/specs/)  │   ◄── tài liệu nghiệp vụ nén thành YAML
                 index • process • roles • fields
                 codebase/ ui_components • state_machine
                                          │
                                          ▼
   ┌────────────────► auto-test ──► TC-<KEY>.spec.ts (có test.fixme)
   │                                      │
   │        record:ticket (web thật) ─────┤
   │        recording.ts (DOM/selector)   │
   │                                      ▼
   │                 regenerate ──► spec bám selector thật, gỡ test.fixme
   │                                      │
   └──────── sync-specs (Reverse-Grounding) ◄── merge selector thật
             live_grounded_components.yaml     (ưu tiên > spec tĩnh)
```

- **Forward:** OpenSpecs → sinh test (grounding).
- **Reverse-Grounding:** selector Tester vừa thao tác → merge ngược vào `docs/specs/codebase/live_grounded_components.yaml` → **ticket sau tái dùng ngay** selector đã kiểm chứng (ưu tiên cao hơn spec tĩnh).

> 📐 Vì sao nén codebase thành YAML lại **nhanh, nhẹ & tiết kiệm 95–98% token**? Xem tài liệu kiến trúc chi tiết: **[docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md](./docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md)** (🇬🇧 English: [docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md](./docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md)).

### Tối ưu token — phân tầng model AI

Việc "đọc/trích xuất" dùng model rẻ, việc "suy luận/thiết kế test" mới dùng model mạnh:

```
[1/4] Ingest ticket    → 0 token (scrape DOM)
[2/4] Summarize story  → claude-sonnet-5   (đọc ticket/ảnh/comment → summary.json)
[3/4] Analyze + New-test → claude-opus-4.8 (giải conflict + sinh spec, đọc ~30k token)
[4/4] Verify test      → 0 token (Playwright local)
  └─ nếu FAIL: self-heal → claude-sonnet-5
```

Hạ tầng model khi ticket đơn giản: `npm run auto-test <KEY> -- --sonnet` (hoặc `--model claude-sonnet-5`).

### Tạo Jira Test Sub-task không tốn token — `npm run create-subtask`

Prompt `/create-test-sub-task` (mode `agent`) bắt AI click từng bước trên trình
duyệt để tạo sub-task ⇒ tốn token. Script `scripts/create-subtask.js` làm y hệt
nhưng **0 token**: tận dụng đúng session/profile SSO đã có (`.auth/jira-profile`)
rồi gọi thẳng Jira REST API (`POST /rest/api/2/issue`) ngay trong page context
(dùng chung cookie đăng nhập).

```bash
# Tạo sub-task "Test in DEV ASAP-5568" (assign to me) cho story ASAP-5568
npm run create-subtask -- ASAP-5568

# Chạy ẩn (khi session SSO đã hợp lệ, hợp cho CI)
npm run create-subtask -- ASAP-5568 --headless

# Ghi đè Summary mặc định (chỉ áp dụng khi có ĐÚNG 1 ticket)
npm run create-subtask -- ASAP-5568 --summary "Test in DEV ASAP-5569"

# 🆕 Multi-ticket — cách nhau bằng dấu cách (đăng nhập SSO 1 lần, chạy song song)
npm run create-subtask -- ASAP-101 ASAP-102 ASAP-103

# Gộp vào pipeline auto-test (tạo sub-task ngay sau khi fetch ticket)
npm run auto-test ASAP-5568 -- --create-subtask
```

📖 Chi tiết đầy đủ: **[docs/ADVANCED-GUIDE.md](./docs/ADVANCED-GUIDE.md)**.

---

## 📁 Bản Đồ Thư Mục

```
QA-Playwright-ASAP/
├── .github/
│   └── prompts/            # Prompt logic: analyze-story, new-test, summarize-story, fix-failed-test, ground-page
├── docs/
│   ├── specs/              # OpenSpecs nghiệp vụ: index/process/roles/fields.yaml (template)
│   │   └── codebase/       # Bóc tách từ mã nguồn: ui_components, state_machine, live_grounded_components
│   ├── tickets/            # Ticket đã bóc tách (<KEY>.md + ảnh/diagram) — sinh khi chạy
│   ├── en/                 # 🌐 Tài liệu tiếng Anh (README, ADVANCED-GUIDE, ARCHITECTURE)
│   └── ADVANCED-GUIDE.md   # Tài liệu chi tiết các cơ chế nâng cao
├── scripts/                # auto-test, fetch-jira, record-ticket, sync-specs, generate-codebase-specs...
├── tests/
│   ├── e2e/                # Playwright spec (TC-<KEY>.spec.ts)
│   ├── pages/              # Page Object Model
│   ├── testcases/          # Testcase mô tả (TC-<KEY>.md) — có sẵn _TEMPLATE.md
│   └── recordings/         # File codegen ghi hình (<KEY>.recording.ts)
├── .env.example            # Mẫu cấu hình môi trường (BASE_URL, tài khoản)
├── playwright.config.ts
└── setup-tester.bat / .sh  # Cài đặt 1-click
```

---

## 📚 Tài Liệu Chi Tiết

Các cơ chế nâng cao được tách sang **[docs/ADVANCED-GUIDE.md](./docs/ADVANCED-GUIDE.md)** để README gọn gàng:

1. Spec-Driven Testing — bộ OpenSpecs nghiệp vụ
2. Bóc tách Ticket (Bookmarklet + Playwright automation + tải ảnh/diagram)
3. Grounding & Reverse-Grounding chi tiết
4. Kiến trúc phân tầng model & chạy từng bước qua Copilot Chat
5. Bộ bóc tách OpenSpecs Codebase
6. Quy trình xử lý Blocker & Open Questions (2 giai đoạn)
7. Nhân bản Template sang dự án khác

### 🗂️ Danh Mục Tài Liệu

| Tài liệu | Ngôn ngữ | Nội dung |
| --- | :-: | --- |
| [`docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md`](./docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md) | 🇻🇳 VI | Kiến trúc OpenSpecs YAML — vì sao nhanh, nhẹ & tiết kiệm token (tổng quan kiến trúc kỹ thuật) |
| [`docs/ADVANCED-GUIDE.md`](./docs/ADVANCED-GUIDE.md) | 🇻🇳 VI | Hướng dẫn cơ chế nâng cao end-to-end |
| [`docs/QA_PLAYWRIGHT_OPTIMIZATION_PLAN.md`](./docs/QA_PLAYWRIGHT_OPTIMIZATION_PLAN.md) | 🇻🇳 VI | Kế hoạch tối ưu token & quy trình 1-Click |
| [`docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md`](./docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md) | 🇻🇳 VI | Phân tích gốc rễ: vì sao grounding là bắt buộc |
| [`docs/en/README.md`](./docs/en/README.md) | 🇬🇧 EN | Bản tiếng Anh của README (show khách hàng) |
| [`docs/en/ADVANCED-GUIDE.md`](./docs/en/ADVANCED-GUIDE.md) | 🇬🇧 EN | Advanced operational guide (English) |
| [`docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md`](./docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md) | 🇬🇧 EN | Client-ready architecture whitepaper (English) |
| [`docs/QA_PLAYWRIGHT_OPTIMIZATION_PLAN_EN.md`](./docs/QA_PLAYWRIGHT_OPTIMIZATION_PLAN_EN.md) | 🇬🇧 EN | Token-optimization plan (English) |

> 🌐 **Cho khách hàng quốc tế:** toàn bộ tài liệu tiếng Anh nằm trong **[docs/en/](./docs/en/)**.
