# 🧪 QA Playwright Copilot Starter Kit

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

## 🚀 Quick Start — Quy Trình 3 Bước Chuẩn QA

Sau khi [cài đặt](#-cài-đặt) và [cấu hình `.env`](#-thiết-lập-môi-trường), mỗi ticket chỉ cần 3 lệnh:

```bash
# 1️⃣ Sinh testcase & spec từ ticket (fetch → summarize → analyze → generate → verify)
npm run auto-test ASAP-101

# 2️⃣ Mở web thật, click qua đúng flow chính rồi đóng cửa sổ lại → tự xuất recording
npm run record:ticket ASAP-101

# 3️⃣ Regenerate: tự tham chiếu recording, gỡ test.fixme, đồng bộ OpenSpecs & verify test
npm run regenerate ASAP-101
```

| Bước | Lệnh | Kết quả |
| :-: | --- | --- |
| 1 | `npm run auto-test <KEY>` | `tests/testcases/TC-<KEY>.md` + `tests/e2e/TC-<KEY>.spec.ts` |
| 2 | `npm run record:ticket <KEY>` | `tests/recordings/<KEY>.recording.ts` (DOM/selector thật) |
| 3 | `npm run regenerate <KEY>` | Spec bám selector thật, gỡ `test.fixme`, cập nhật OpenSpecs |

> 💡 Có thể dùng link ticket thay cho `<KEY>`: `npm run auto-test https://your-jira/browse/ASAP-101`.

---

## 📋 Bảng Tra Cứu Lệnh Nhanh (Cheatsheet)

| Lệnh | Công dụng |
| --- | --- |
| `npm run auto-test <KEY>` | Pipeline 4 bước: fetch ticket → summarize → analyze + generate → verify (thêm `-- --create-subtask` để tạo luôn Jira Test Sub-task 0 token) |
| `npm run regenerate <KEY>` | Regenerate spec từ recording (bỏ qua fetch/summarize), gỡ `test.fixme` |
| `npm run record:ticket <KEY>` | Mở web thật + codegen, ghi lại flow → `tests/recordings/<KEY>.recording.ts` |
| `npm run sync-specs <KEY>` | *(Tiện ích phụ)* Merge thủ công selector từ recording vào OpenSpecs (đã tự động chạy ngầm ở bước regenerate) |
| `npm run fetch-ticket <KEY>` | Bóc tách ticket (text + ảnh + diagram) vào `docs/tickets/` |
| `npm run create-subtask <KEY>` | **(0 token)** Tạo Jira Test Sub-task `Test in DEV <KEY>` (assign to me) bằng Playwright thuần qua REST API — thay cho prompt AI `/create-test-sub-task` |
| `npm test` | Chạy toàn bộ test (headless) |
| `npm run test:headed` | Chạy test có hiển thị trình duyệt |
| `npm run test:ui` | Mở Playwright UI Mode (tua thời gian, debug trực quan) |
| `npm run test:debug` | Chạy test ở chế độ debug |
| `npm run report` | Mở HTML report của lần chạy gần nhất |
| `npm run generate-codebase-specs` | Bóc tách OpenSpecs từ mã nguồn ứng dụng (nếu có) |

> Chạy 1 file cụ thể: `npx playwright test tests/e2e/TC-ASAP-101.spec.ts`.
> Trong VSCode: bấm **`F5`** hoặc mở tab 🧪 **Testing** → nút ▶️ Play.

---

## 🧰 Cài Đặt

```bash
git clone https://github.com/ndloc22/QA-Playwright-ASAP.git
cd QA-Playwright-ASAP
```

Rồi chạy cài đặt tự động:
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

> Session đăng nhập được lưu tại `.auth/user.json` để `record:ticket` vào thẳng app đã login, không phải re-login mỗi lần.

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

# Ghi đè Summary mặc định
npm run create-subtask -- ASAP-5568 --summary "Test in DEV ASAP-5569"

# Gộp vào pipeline auto-test (tạo sub-task ngay sau khi fetch ticket)
npm run auto-test ASAP-5568 -- --create-subtask
```

**Bảng cờ (flags) của `create-subtask`:**

| Cờ / Biến môi trường | Ý nghĩa |
| --- | --- |
| *(mặc định)* | Headed — mở cửa sổ Chrome để đăng nhập SSO/2FA lần đầu |
| `--headless` | Chạy ẩn khi session SSO đã hợp lệ (hợp cho CI) |
| `--headed` | Buộc mở cửa sổ (ghi đè `CREATE_SUBTASK_HEADLESS`) |
| `--summary "<text>"` | Ghi đè Summary mặc định (`Test in DEV <KEY>`) |
| `CREATE_SUBTASK_HEADLESS=1` | Tương đương `--headless` |
| `JIRA_BASE_URL` | Ghi đè domain Jira (mặc định `https://jira.eon.com`) |

Đặc điểm an toàn:
- **Idempotent**: nếu sub-task trùng Summary đã tồn tại thì bỏ qua, không tạo trùng.
- **Headed mặc định** để đăng nhập SSO/2FA lần đầu; **`--headless`** khi phiên đã hợp lệ.
- Assignee = current user (tương đương "Assign to me"); các field khác giữ mặc định (kế thừa story cha).
- Xử lý lỗi graceful (chưa đăng nhập, sai key, mạng lỗi) và **không chặn** luồng sinh/kiểm thử test hiện có khi chạy qua `--create-subtask`.
- Ghi đè domain qua biến môi trường `JIRA_BASE_URL` (mặc định `https://jira.eon.com`).


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
