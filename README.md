# ⚡ E.ON ASAP — Playwright E2E Automation

> Kiểm thử tự động E2E cho hệ thống **ASAP** của **E.ON**.
> Nền tảng: **Playwright + TypeScript + Page Object Model + GitHub Copilot**.

Từ 1 mã Jira Ticket (`ASAP-<ID>`) → testcase + Playwright spec hoàn chỉnh, grounding vào DOM thật, tối ưu token AI.

---

## 🧭 Bạn thuộc nhóm nào? (Đọc phần này trước)

Dự án phục vụ **2 nhóm người dùng** với mục đích khác nhau. Hãy xác định đúng nhóm của bạn để đi thẳng vào phần hướng dẫn phù hợp:

| Nhóm | Bạn là ai? | Bạn muốn làm gì? | Đi tới |
| :-: | --- | --- | --- |
| **1** | Làm việc với **Jira Ticket** | Sinh testcase + spec **tự động từ ticket ASAP** rồi kiểm chứng trên web thật (`auto-test` → `record:ticket` → `regenerate`) | [→ Nhóm 1: Auto-Test từ Jira](#nhom-1) |
| **2** | Tạo & kiểm thử **function/module** | Tự **tạo mới một function** độc lập: ghi hình flow (`record:function`) → sinh POM + spec → chạy & debug | [→ Nhóm 2: Tạo & chạy function](#nhom-2) |

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

Tạo file `.env` (tham khảo `.env.example`) và trỏ `BASE_URL` sang máy chủ test của dự án ASAP:

```ini
# Server Test E.ON ASAP
BASE_URL=https://your-asap-test-server.example.com/asap

# Hoặc môi trường Axon Ivy Cloud:
# BASE_URL=https://bolt.server.ivy-cloud.com/ivy_12_kf/EON_LDAP/asap

# Tài khoản đăng nhập (dùng cho login & ghi hình)
TEST_USERNAME=your_username
TEST_PASSWORD=your_password
```

> 🔐 Session đăng nhập được lưu tại `.auth/user.json` để `record:ticket` vào thẳng app đã login, không phải re-login mỗi lần.

---

# 👥 Hướng Dẫn Sử Dụng Theo Nhóm Người Dùng

## <a id="nhom-1"></a>🎫 NHÓM 1 — Người làm việc với Jira Ticket

> **Mục tiêu:** Từ **1 mã Jira ASAP** → sinh ra testcase + Playwright spec hoàn chỉnh, bám selector DOM thật.
>
> **Yêu cầu:** đã cấu hình `.env` trỏ tới server test ASAP.

### Quy trình 3 bước chuẩn (mỗi ticket)

```bash
# 1️⃣ Sinh testcase & spec từ Jira (fetch ticket → summarize → analyze → generate → verify)
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

> 💡 Có thể thay `<KEY>` bằng link Jira đầy đủ: `npm run auto-test https://jira.eon.com/browse/ASAP-101`.
> 💰 Ticket đơn giản → hạ tầng model cho rẻ: `npm run auto-test <KEY> -- --sonnet` (hoặc `--model claude-sonnet-5`).

### Các lệnh phụ trợ cho Nhóm 1

| Lệnh | Công dụng |
| --- | --- |
| `npm run fetch-ticket <KEY>` | Bóc tách Jira ticket (text + ảnh + diagram) vào `docs/tickets/` |
| `npm run create-subtask <KEY> [KEY2 ...]` | **(0 token)** Tạo Jira Test Sub-task `Test in DEV <KEY>` (assign to me) qua REST API — hỗ trợ **multi-ticket** |
| `npm run sync-specs <KEY>` | Merge selector từ recording vào OpenSpecs (không ghi đè file đã có) |
| `npm run sync-specs <KEY> force` | **Ghi đè** cả POM lẫn spec ngay |
| `npm run sync-specs:force <KEY>` | Alias 1-click tương đương lệnh trên |
| `npm run generate-codebase-specs` | Bóc tách OpenSpecs từ mã nguồn Axon Ivy của dự án |

> ✅ Sau bước 3, spec đã bám selector thật — **chuyển sang phần [Nhóm 2](#nhom-2) để chạy & xem kết quả test.**

---

## <a id="nhom-2"></a>▶️ NHÓM 2 — Người tạo & kiểm thử function/module

> **Mục tiêu:** Tự **tạo mới một function/module độc lập** — ghi hình flow trên web thật → sinh **Page Object Model + Starter Spec** → chạy & debug function đó. **Không cần Jira ticket.**
>
> **Yêu cầu:** đã [Cài Đặt](#-cài-đặt) và cấu hình `.env` trỏ server test ASAP.

### Quy trình tạo function mới (2 bước chuẩn)

```bash
# 1️⃣ Ghi hình flow của function trên web thật (đặt tên function, KHÔNG cần mã Jira)
npm run record:function <FUNCTION_NAME>

# 2️⃣ Sinh Page Object Model + Starter Spec từ recording vừa ghi
npm run sync-specs <FUNCTION_NAME>

#    (tùy chọn) Ghi đè khi POM/spec của function đã tồn tại từ trước
npm run sync-specs:force <FUNCTION_NAME>
```

| Bước | Lệnh | Kết quả sinh ra |
| :-: | --- | --- |
| 1 | `npm run record:function <FUNCTION_NAME>` | `tests/recordings/functions/<FUNCTION_NAME>.recording.ts` (DOM/selector thật) |
| 2 | `npm run sync-specs <FUNCTION_NAME>` | `tests/pages/functions/<FunctionName>Page.ts` (POM) + `tests/e2e/functions/TC-<FUNCTION_NAME>.spec.ts` (starter spec) |
| 2* | `npm run sync-specs:force <FUNCTION_NAME>` | **Ghi đè** POM + spec đã có (mặc định KHÔNG ghi đè để an toàn) |

> 💡 `<FUNCTION_NAME>` là tên module tự đặt (chữ IN HOA, vd `LOGIN`, `ORDER_CREATION`). POM được đặt tên PascalCase (vd `LoginPage.ts`).
> 🗂️ **Gom nhóm chống xung đột:** artifact của function nằm trong thư mục con `functions/` (`tests/recordings/functions/`, `tests/pages/functions/`, `tests/e2e/functions/`, `tests/testcases/functions/`), tách biệt với file Jira Ticket (Nhóm 1). `sync-specs` tạo thêm **proxy export** tại `tests/pages/<Name>Page.ts` nên mọi import cũ vẫn chạy 100%.
> 🔁 `sync-specs` còn **merge ngược** selector thật vào OpenSpecs (Reverse-Grounding) → function sau tái dùng ngay selector đã kiểm chứng.

### Chạy & Debug một function

```bash
# Chạy toàn bộ spec của 1 function
npx playwright test tests/e2e/functions/TC-<FUNCTION_NAME>.spec.ts

# Chạy đúng 1 testcase cụ thể trong function (filter -g theo mã testcase)
npx playwright test tests/e2e/functions/TC-<FUNCTION_NAME>.spec.ts -g "01"

# Debug step-by-step đúng testcase đó (dừng từng bước)
npx playwright test tests/e2e/functions/TC-<FUNCTION_NAME>.spec.ts -g "01" --debug
```

| Lệnh | Công dụng |
| --- | --- |
| `npm run test:ui` | Mở **Playwright UI Mode** (tua thời gian, debug trực quan từng bước) |
| `npm run test:headed` | Chạy test **có hiển thị trình duyệt** để quan sát trực tiếp |
| `npm run test:debug` | Chạy test ở chế độ **debug** (dừng từng bước) |
| `npm run report` | Mở **HTML report** + xem lại **video Full-HD 1080p** của test run |
| `npm run clean` | Dọn dẹp video & báo cáo cũ (`test-results/`, `playwright-report/`) |

> 🖱️ **Trong VSCode:** bấm **`F5`** hoặc mở tab 🧪 **Testing** → nút ▶️ Play (hoặc 🐞 Debug từng test).

### Lệnh bổ trợ & tùy chọn nâng cao

| Nhu cầu | Lệnh / Thiết lập |
| --- | --- |
| Chạy **toàn bộ** test **tuần tự** (1 worker — tránh xung đột session server) | `npm test` |
| Chạy **song song** nhiều test | `npm test -- --workers=4` |
| Xem video **chậm hơn** để thuyết trình | `set SLOWMO=800` rồi chạy test |
| Chạy **nhanh tối đa** (tắt giãn nhịp) | `set SLOWMO=0` rồi chạy test |

> 🎥 **Video tự động quay Full-HD (1920×1080)** cho **mọi** lần chạy (kể cả khi PASS). Nhịp thao tác mặc định **400 ms/bước** để tester xem lại rõ ràng. Xem lại bằng `npm run report`.

---

## 📋 Bảng Tra Cứu Toàn Bộ Lệnh (Cheatsheet)

| Lệnh | Nhóm | Công dụng |
| --- | :-: | --- |
| `npm run auto-test <KEY>` | 1 | Pipeline 4 bước: fetch Jira → summarize → analyze + generate → verify |
| `npm run regenerate <KEY>` | 1 | Regenerate spec từ recording (bỏ qua fetch/summarize), gỡ `test.fixme` |
| `npm run record:ticket <KEY>` | 1 | Mở web thật + codegen, ghi flow Jira Ticket → `tests/recordings/<KEY>.recording.ts` |
| `npm run record:function <FUNCTION>` | 2 | Mở web thật + codegen, ghi flow Function → `tests/recordings/functions/<FUNCTION>.recording.ts` |
| `npm run fetch-ticket <KEY>` | 1 | Bóc tách Jira ticket (text + ảnh + diagram) vào `docs/tickets/` |
| `npm run create-subtask <KEY> [KEY2 ...]` | 1 | **(0 token)** Tạo Jira Test Sub-task `Test in DEV <KEY>` (assign to me) qua REST API |
| `npm run sync-specs <KEY|FUNCTION>` | 1·2 | Merge selector (Reverse-Grounding) + sinh POM & starter spec (không ghi đè file đã có) |
| `npm run sync-specs <KEY|FUNCTION> force` | 1·2 | **Ghi đè** cả POM lẫn spec ngay |
| `npm run sync-specs:force <KEY|FUNCTION>` | 1·2 | Alias 1-click tương đương lệnh trên |
| `npm run generate-codebase-specs` | 1 | Bóc tách OpenSpecs từ mã nguồn Axon Ivy |
| `npm test` | 2 | Chạy toàn bộ test **tuần tự** (1 worker) |
| `npm test -- --workers=4` | 2 | Chạy song song |
| `npm run test:headed` | 2 | Chạy test có hiển thị trình duyệt |
| `npm run test:ui` | 2 | Mở Playwright UI Mode |
| `npm run test:debug` | 2 | Chạy test ở chế độ debug |
| `npm run report` | 2 | Mở HTML report + xem lại video Full-HD 1080p |
| `npm run clean` | 2 | Xóa sạch video & báo cáo cũ |

---

## 🧠 Kiến Trúc Thông Minh (Tinh Gọn)

### OpenSpecs + Reverse-Grounding — tri thức sống tự học

Thay vì nạp toàn bộ tài liệu cồng kềnh vào AI, dự án nén nghiệp vụ thành **OpenSpecs** (YAML) và tự bồi đắp từ recording thật:

```
   Jira Ticket ──► fetch-ticket ──► docs/tickets/<KEY>.md (+ ảnh/diagram)
                                          │
                 OpenSpecs (docs/specs/)  │   ◄── Nghiệp vụ nén ~86% token
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
- **Reverse-Grounding:** selector Tester vừa thao tác → merge ngược vào OpenSpecs → **ticket sau tái dùng ngay** selector đã kiểm chứng.

> 📐 Vì sao nén codebase thành YAML lại **nhanh, nhẹ & tiết kiệm 95–98% token**? Xem tài liệu kiến trúc chi tiết: **[docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md](./docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md)** (🇬🇧 English: [docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md](./docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md)).

### Tối ưu token — phân tầng model AI

Việc "đọc/trích xuất" dùng model rẻ, việc "suy luận/thiết kế test" mới dùng model mạnh:

```
[1/4] Ingest Jira      → 0 token (scrape DOM)
[2/4] Summarize story  → claude-sonnet-5   (đọc ticket/ảnh/comment → summary.json)
[3/4] Analyze + New-test → claude-opus-4.8 (giải conflict + sinh spec, đọc ~30k token)
[4/4] Verify test      → 0 token (Playwright local)
  └─ nếu FAIL: self-heal → claude-sonnet-5
```

### Tạo Jira Test Sub-task không tốn token — `npm run create-subtask`

Script `scripts/create-subtask.js` tận dụng session/profile SSO đã có (`.auth/jira-profile`) rồi gọi thẳng Jira REST API (`POST /rest/api/2/issue`) với chi phí **0 token**.

```bash
# Tạo sub-task cho story ASAP-5568
npm run create-subtask -- ASAP-5568

# Multi-ticket song song (1 lần SSO)
npm run create-subtask -- ASAP-101 ASAP-102 ASAP-103
```

📖 Chi tiết đầy đủ: **[docs/ADVANCED-GUIDE.md](./docs/ADVANCED-GUIDE.md)**.

---

## 📁 Bản Đồ Thư Mục

```
QA-Playwright-ASAP/
├── .github/
│   ├── prompts/            # Prompt logic: analyze-story, new-test, summarize-story, fix-failed-test, ground-page
│   └── skills/             # 14 Axon Ivy Skills (Tier-1) cho Copilot
├── docs/
│   ├── specs/              # OpenSpecs nghiệp vụ: index/process/roles/fields.yaml
│   │   └── codebase/       # Bóc tách từ mã nguồn: ui_components, state_machine, live_grounded_components
│   ├── tickets/            # Jira ticket đã bóc tách (<KEY>.md + ảnh/diagram)
│   ├── en/                 # 🌐 Tài liệu tiếng Anh (README, ADVANCED-GUIDE, ARCHITECTURE)
│   ├── ADVANCED-GUIDE.md   # Tài liệu chi tiết các cơ chế nâng cao
│   └── IVY-SKILLS-MANIFEST.md
├── scripts/                # auto-test, fetch-jira, record-ticket, sync-specs, generate-codebase-specs...
├── tests/
│   ├── e2e/                # Playwright spec (TC-<KEY>.spec.ts)
│   ├── pages/              # Page Object Model
│   ├── testcases/          # Testcase mô tả (TC-<KEY>.md)
│   └── recordings/         # File codegen ghi hình (<KEY>.recording.ts)
├── .env.example            # Mẫu cấu hình môi trường (BASE_URL, credentials)
├── playwright.config.ts
└── setup-tester.bat / .sh  # Cài đặt 1-click
```

---

## 📚 Tài Liệu Chi Tiết

Các cơ chế nâng cao được tách sang **[docs/ADVANCED-GUIDE.md](./docs/ADVANCED-GUIDE.md)** để README gọn gàng:

1. Spec-Driven Testing — bộ OpenSpecs nghiệp vụ
2. Bóc tách Jira Ticket (Bookmarklet + Playwright automation + tải ảnh/diagram)
3. Grounding & Reverse-Grounding chi tiết
4. Kiến trúc phân tầng model & chạy từng bước qua Copilot Chat
5. Bộ bóc tách OpenSpecs Codebase
6. Bộ 14 Axon Ivy Skills Tier-1
7. Quy trình xử lý Blocker & Open Questions (2 giai đoạn)
8. Nhân bản Template sang dự án khác

### 🗂️ Danh Mục Tài Liệu

| Tài liệu | Ngôn ngữ | Nội dung |
| --- | :-: | --- |
| [`docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md`](./docs/CODEBASE_YAML_SPECS_ARCHITECTURE.md) | 🇻🇳 VI | Kiến trúc OpenSpecs YAML — vì sao nhanh, nhẹ & tiết kiệm token (tổng quan kiến trúc kỹ thuật) |
| [`docs/ADVANCED-GUIDE.md`](./docs/ADVANCED-GUIDE.md) | 🇻🇳 VI | Hướng dẫn cơ chế nâng cao end-to-end |
| [`docs/IVY-SKILLS-MANIFEST.md`](./docs/IVY-SKILLS-MANIFEST.md) | 🇻🇳 VI | Danh mục 14 Axon Ivy Skills tích hợp cho Copilot |
| [`docs/en/README.md`](./docs/en/README.md) | 🇬🇧 EN | Bản tiếng Anh của README (show khách hàng) |
| [`docs/en/ADVANCED-GUIDE.md`](./docs/en/ADVANCED-GUIDE.md) | 🇬🇧 EN | Advanced operational guide (English) |
| [`docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md`](./docs/en/CODEBASE_YAML_SPECS_ARCHITECTURE.md) | 🇬🇧 EN | Client-ready architecture whitepaper (English) |

> 🌐 **Cho khách hàng quốc tế:** toàn bộ tài liệu tiếng Anh nằm trong **[docs/en/](./docs/en/)**.

---

## 🔗 Tài Liệu Tham Khảo (References)

Các dự án mã nguồn mở và tiêu chuẩn kiến trúc tham khảo:

- **[OpenSpec (Fission AI)](https://github.com/Fission-AI/OpenSpec)** — Chuẩn đặc tả YAML có cấu trúc (Spec-driven AI development kernel & structured specifications) dành cho Agentic workflows.
- **[Stagehand (Browserbase)](https://github.com/browserbase/stagehand)** — Framework web agent điều khiển trình duyệt thông minh trên nền Playwright với AI tự động phát hiện phần tử DOM.
- **[Playwright-BDD](https://github.com/vitalets/playwright-bdd)** — Mô hình kết hợp đặc tả kịch bản kiểm thử (BDD/spec-driven) trực tiếp với Playwright test runner.
- **[Microsoft Playwright](https://github.com/microsoft/playwright)** — Framework kiểm thử E2E cốt lõi, công cụ Codegen ghi nhận tương tác DOM thực tế và kiến trúc Page Object Model (POM).
