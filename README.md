<div align="center">

# 🎭 QA-Playwright-ASAP

**E2E Test Automation cho E.ON Axon Ivy CyberSec Portal**
*Playwright + AI Copilot — Workflow 1 lệnh, tối ưu cho Tester*

`Login` → `Record` → `Run` → `Self-Heal`

</div>

---

## 📖 Mục lục

1. [Tổng quan kiến trúc (30 giây)](#1--tổng-quan-kiến-trúc-30-giây)
2. [Cài đặt nhanh](#2--cài-đặt-nhanh-2-phút)
3. [Đăng nhập & Chuyển môi trường](#3--đăng-nhập--chuyển-môi-trường-linh-hoạt)
4. [2 Luồng Record](#4--hai-luồng-record-tách-bạch)
5. [Chạy Test hồi quy (Playwright Native)](#5--chạy-test-hồi-quy--playwright-native-0-token)
6. [Cheat Sheet — Tra cứu lệnh nhanh](#6--cheat-sheet--tra-cứu-lệnh-nhanh)
7. [Cấu trúc thư mục](#7--cấu-trúc-thư-mục-dự-án)
8. [FAQ & Mẹo cho Tester](#8--faq--mẹo-cho-tester)

---

## 1. 🧭 Tổng quan kiến trúc (30 giây)

Dự án biến thao tác thủ công của Tester thành bộ test tự động **ổn định, chạy lại 0 token**. Triết lý cốt lõi:

> **Không đoán mò selector: Ghi lại DOM thật từ thao tác — Để AI tự động thiết kế và sinh mã kiểm thử.**

```
                 ┌─────────────────────────────────────────────┐
   1. LOGIN  →   │  Đăng nhập SSO/MFA 1 lần → lưu .auth/user.json │
                 └─────────────────────────────────────────────┘
                                   │  (tái dùng session, không login lại)
          ┌────────────────────────┴────────────────────────┐
          ▼                                                  ▼
  2a. MANUAL RECORD                               2b. AUTO-RECORD (AI)
  npm run record:function                         npm run record:agent
  Tester tự click tay                             AI Agent lái browser bằng prompt
          │                                                  │
          └────────────────────────┬────────────────────────┘
                                    ▼
                    recording.ts  →  Page Object (POM)  +  Spec (.ts/.md)
                                    │   (sync-specs: reverse-grounding selector)
                                    ▼
   3. RUN HỒI QUY   →   npm run test:function   (Playwright Native, 0 token, CI/CD)
                                    │
                                    ▼  (nếu FAIL)
   4. SELF-HEAL     →   npm run heal   (AI tự vá POM/Spec, có guardrail revert)
```

**Khối chính:**

| Lớp | Thành phần | Vai trò |
|:---|:---|:---|
| 🔐 Auth | `.auth/user.json` | Session đăng nhập tái dùng, bỏ qua SSO/MFA ở các lần sau |
| 🎬 Record | `record:function` / `record:agent` | Sinh `recording.ts` chứa selector DOM thật |
| 🧱 POM | `tests/pages/functions/*Page.ts` | Page Object — selector đã verify, tái sử dụng |
| 📄 Spec | `tests/e2e/functions/TC-*.spec.ts` | Test Playwright thực thi |
| ▶️ Run | `test:function` | Chạy native, 0 token, cho CI/CD & hồi quy |
| 🩹 Heal | `heal` | AI vá test khi fail, tự revert nếu hỏng |

---

## 2. ⚡ Cài đặt nhanh (~2 phút)

```bash
# 1️⃣  Cài dependencies + trình duyệt
npm install
npx playwright install chromium

# 2️⃣  Tạo file môi trường
cp .env.example .env        # → điền BASE_URL, TEST_USERNAME, TEST_PASSWORD

# 3️⃣  Đăng nhập & lưu session (1 lần duy nhất)
npm run login
```

> ✅ Xong! Session lưu ở `.auth/user.json`. Từ giờ mọi lệnh record/test đều tự dùng lại phiên này.

---

## 3. 🔐 Đăng nhập & Chuyển môi trường linh hoạt

Một lệnh `npm run login` lo trọn 3 việc: **đăng nhập SSO/MFA → tự lưu session → tự sync `.env`**.

### 3.1. Cú pháp

```bash
npm run login                       # Dùng BASE_URL hiện tại trong .env
npm run login dev                   # Chuyển sang môi trường alias "dev"
npm run login qa1                   # Chuyển sang môi trường alias "qa1"
npm run login https://host/app      # Đăng nhập thẳng vào 1 URL bất kỳ (ad-hoc)
```

### 3.2. Cơ chế tự động

| Cơ chế | Mô tả |
|:---|:---|
| 🔑 **Tự lưu session** | Sau khi đăng nhập thành công, session (cookies + storage) được lưu vào `.auth/user.json`. Với môi trường có alias, còn giữ thêm bản riêng `.auth/user.<env>.json` → **chuyển qua lại không phải login lại**. |
| 🔄 **Tự sync `.env`** | Dòng `BASE_URL=` trong `.env` được **cập nhật tự động** theo môi trường vừa chọn. Nhờ đó mọi lệnh sau (`test:function`, `record:function`, `qa`...) đều trỏ đúng môi trường — không cần sửa tay. |
| 🙋 **SSO/MFA thủ công** | Trình duyệt mở ở chế độ headed: Tester nhập email/mật khẩu + duyệt MFA trên điện thoại như bình thường. Script tự phát hiện khi đã vào app và lưu session. |

### 3.3. Định nghĩa môi trường

Các alias (`dev`, `qa1`, ...) khai báo trong **`config/environments.json`** — Tester có thể sửa URL hoặc thêm môi trường mới:

```json
{
  "default": "dev",
  "environments": {
    "dev": { "baseUrl": "https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec" },
    "qa1": { "baseUrl": "https://bpm-qa.eon.com/qa1_cybersec12/EON_LDAP/CyberSec" }
  }
}
```

### 3.4. Cờ bổ sung & làm mới session

```bash
npm run login qa1 -- --timeout 240     # chờ MFA tối đa 240s (MFA điện thoại chậm)
npm run login -- --url /some/deep/path # bắt đầu từ URL sâu hơn
npm run login:refresh                  # xóa session cũ rồi đăng nhập lại
```

---

## 4. 🎬 Hai luồng Record (tách bạch)

Cả hai luồng đều cho ra **cùng 1 output**: `recording.ts` → Page Object + Spec. Khác nhau ở **ai điều khiển chuột**.

| | **Luồng 1 — Manual Record** | **Luồng 2 — Prompt-Driven Auto-Record** |
|:---|:---|:---|
| **Lệnh** | `npm run record:function <KEY>` | `npm run record:agent <KEY>` |
| **Ai lái browser?** | 👤 **Tester tự click tay** | 🤖 **AI Agent** (theo prompt) |
| **Token** | 🟢 0 token | 🔵 AI CLI (1 lần record) |
| **Dùng khi** | Flow cần mắt người, thao tác tinh tế | Flow rõ ràng, muốn tự động hoá việc record |
| **Output** | recording → POM → Spec → auto verify | recording → POM → Spec |

### 4.1. 👤 Luồng 1 — Manual Record (`record:function`)

Tester thao tác thật trên trình duyệt; recorder ghi lại selector DOM chuẩn, sau đó **tự sinh POM + Spec + tự verify**.

```bash
npm run record:function CREATE_RISK_REQUEST
# → Trình duyệt mở (đã đăng nhập sẵn) → Tester click/điền thật → đóng cửa sổ
# → Tự sinh Page Object + Spec + chạy verify PASS/FAIL
```

**🎯 PrimeFaces Capture Bridge** — recorder bắt trọn **100%** thao tác PrimeFaces mà codegen thường bỏ sót:
- ✅ Dropdown `p:selectOneMenu` — ghi đúng click chọn option trong overlay panel.
- ✅ Multi-select `p:selectCheckboxMenu` — giữ panel sống suốt thao tác, **không cần double-click**, sinh locator `getByRole('option', { name })` ổn định thay cho `div.nth()` dễ gãy.
- ✅ Checkbox/radio — gắn nhãn ổn định `data-stable-label`.

### 4.2. 🤖 Luồng 2 — Prompt-Driven Auto-Record (`record:agent`)

Tester đưa **prompt 1 lần** → AI Agent "nhìn" UI và tự điều khiển browser (Perceive → Plan → Act). **Instrumented Executor** chặn mọi action **thành công** và ghi đúng selector sạch (ưu tiên `getByRole`/`getByLabel`/`[id]`) ra `recording.ts`, rồi tự chạy `sync-specs` sinh POM + Spec.

```bash
# Prompt từ file (khuyến nghị) + chạy luôn test:function để xác nhận GREEN
npm run record:agent CREATE_RISK_REQUEST -- --prompt-file docs/tester-prompts/create-risk-request.prompt.md --run

# Prompt inline
npm run record:agent CREATE_RISK_REQUEST -- --prompt "Mở Start Process, điền Risk Title='x' rồi bấm Next"

# Tuỳ chọn khác
npm run record:agent <KEY> -- --cli claude --slowmo 400 --max-steps 40
npm run record:agent <KEY> -- --no-sync     # chỉ ghi recording, không sinh POM/Spec
```

> ℹ️ Không truyền `--prompt-file`/`--prompt` → tự fallback sang `docs/tester-prompts/<key>.prompt.md` rồi `tests/testcases/functions/TC-<KEY>.md`. Guard `--max-steps` (mặc định 60) chống loop vô hạn & cháy token; 3 action lỗi liên tiếp → dừng an toàn, vẫn lưu phần đã ghi.

### 4.3. ✍️ Chỉnh sửa kịch bản qua Markdown (0 token)

Sau record, kịch bản gốc lưu dạng Markdown dễ đọc tại `tests/testcases/functions/TC-<KEY>.md`. **Tester không cần biết TypeScript** vẫn sửa được dữ liệu/assertion, rồi biên dịch lại:

```bash
npm run md-to-spec CREATE_RISK_REQUEST   # ~0.2s, 0 token, tự đối chiếu method với POM
```

---

## 5. ▶️ Chạy Test hồi quy — Playwright Native (0 token)

Luồng hồi quy chính dùng cho hằng ngày & CI/CD: **`npm run test:function`**.

```bash
npm run test:function CREATE_RISK_REQUEST
npm run test:function CREATE_RISK_REQUEST -- -g "01"      # lọc 1 kịch bản
npm run test:function CREATE_RISK_REQUEST -- --debug      # debug từng bước
npm run test:function CREATE_RISK_REQUEST -- --slowmo 600 # chỉnh tốc độ
```

| Đặc điểm | Giá trị |
|:---|:---|
| 💰 Chi phí | 🟢 **0 token** — chạy bằng code Playwright thuần |
| ⚡ Tốc độ | Siêu nhanh, ổn định 100% (deterministic) |
| 🔁 Mục đích | **Kiểm thử hồi quy & CI/CD** |
| 🔐 Auth | Tự tái dùng `.auth/user.json`; có SSO hand-off tương tác khi session hết hạn |

> 💡 Test fail? Dùng **`npm run heal <KEY>`** — AI đọc trace/screenshot, tự vá POM/Spec, chạy `tsc` trước & sau, **tự revert** nếu làm hỏng cú pháp.

### Các chế độ chạy khác

| Lệnh | Tên | Token | Dùng khi |
|:---|:---|:-:|:---|
| `npm run test:function <KEY>` | 🧩 Native Deterministic | 🟢 0 | **Hồi quy & CI/CD** (mặc định) |
| `npm run test:agent <KEY>` | 🤖 Autonomous AI Agent | 🔵 AI | UI thay đổi, cần AI tự suy luận DOM |
| `npm run heal <KEY>` | 🩹 Offline Self-Healing | 🔵 AI | Vá test khi FAIL (có guardrail revert) |

---

## 6. 📋 Cheat Sheet — Tra cứu lệnh nhanh

| Lệnh | Chức năng |
|:---|:---|
| `npm run login [dev\|qa1\|<url>]` | 🔐 Đăng nhập + tự lưu session + tự sync `.env` theo môi trường |
| `npm run login:refresh` | ♻️ Xóa session cũ & đăng nhập lại |
| `npm run record:function <KEY>` | 👤 **Luồng 1** — Manual Record (Tester click tay) → POM/Spec + verify |
| `npm run record:agent <KEY>` | 🤖 **Luồng 2** — Prompt-driven Auto-Record (AI lái browser) → POM/Spec |
| `npm run md-to-spec <KEY>` | ✍️ Biên dịch `.md` → Spec (0 token, ~0.2s) |
| `npm run test:function <KEY>` | ▶️ **Hồi quy Native** — 0 token, siêu tốc, CI/CD |
| `npm run test:agent <KEY>` | 🤖 Chạy bằng AI Agent (tự suy luận DOM) |
| `npm run heal <KEY>` | 🩹 AI tự vá POM/Spec khi test FAIL (auto-revert) |
| `npm run qa <KEY>` | 🎬 Pipeline trọn gói: Fetch → Summarize → Record → Sync → AI Matrix → Test → Heal |
| `npm run fetch-ticket -- <KEY>` | 📥 Lấy story Jira → `docs/tickets/<KEY>.md` |
| `npm run login:jira -- <KEY>` | 🔐 Đăng nhập Jira 1 lần → `.auth/jira.json` (không bị hỏi lại MFA) |
| `npm run sync-specs <KEY>` | 🔧 Sinh POM + Spec từ recording sẵn có |
| `npm run test:post-deploy` | 🔥 Smoke test sau deploy (menu health + function chain) |
| `npm run clean:testcase` | 🧹 Reset testcase (có tự backup vào `.backup_testcases/`) |
| `npm run clean` | 🗑️ Xóa `test-results`, `playwright-report`, `blob-report` |
| `npm run test:ui` · `test:debug` · `report` | 🔍 Playwright UI mode / debug / mở HTML report |

---

## 7. 🗂️ Cấu trúc thư mục dự án

```
QA-Playwright-ASAP/
├── config/
│   ├── environments.json          # 🌐 Map alias môi trường (dev, qa1...) → BASE_URL
│   ├── agent.json                 # Cấu hình AI Agent (Mode agent & heal)
│   └── post-deploy-smoke.json     # Chuỗi function cho smoke test
├── docs/
│   ├── tickets/                   # Vé Jira đã fetch (<KEY>.md)
│   ├── tester-prompts/            # Prompt cho record:agent (<KEY>.prompt.md)
│   └── specs/codebase/            # Grounded components (YAML)
├── scripts/
│   ├── login.js                   # 🔐 Đăng nhập + chuyển môi trường + sync .env
│   ├── record-ticket.js           # 🎬 Luồng 1 — Codegen + PrimeFaces Capture Bridge
│   ├── record-agent.js            # 🤖 Luồng 2 — Prompt-driven Auto-Record
│   ├── run-function.js            # ▶️ Native Deterministic Runner (0 token)
│   ├── run-agent.js               # 🤖 Autonomous AI Agent Runner
│   ├── ai-healer.js               # 🩹 Offline Self-Healing
│   ├── md-to-spec.js              # ✍️ Markdown → Spec compiler
│   ├── sync-specs.js              # 🔧 POM + Spec generator (Reverse-Grounding)
│   ├── qa.js                      # 🎬 Record-First wizard (pipeline trọn gói)
│   └── clean-testcases.js         # 🧹 Reset + backup
├── tests/
│   ├── e2e/functions/             # Specs:            TC-<KEY>.spec.ts
│   ├── pages/functions/           # Page Object:      <Name>Page.ts
│   ├── recordings/functions/      # Recordings:       <KEY>.recording.ts
│   └── testcases/functions/       # Mô tả testcase:   TC-<KEY>.md
├── .auth/                         # 🔐 Session (user.json, user.<env>.json) — KHÔNG commit
├── .env                           # Biến môi trường (BASE_URL tự sync khi login)
├── .env.example
└── playwright.config.ts
```

---

## 8. ❓ FAQ & Mẹo cho Tester

<details open>
<summary><b>🔐 SSO/MFA — làm sao không phải đăng nhập lại mỗi lần?</b></summary>

Đăng nhập 1 lần bằng `npm run login` → session lưu vào `.auth/user.json` và được **mọi lệnh record/test tái dùng tự động**. Khi chuyển môi trường (`login dev` / `login qa1`), mỗi môi trường giữ bản session riêng nên **chuyển qua lại không phải login lại**. Chỉ khi cookie hết hạn mới cần `npm run login:refresh`. MFA điện thoại chậm? Thêm `-- --timeout 240`.
</details>

<details>
<summary><b>☑️ PrimeFaces checkboxmenu — tại sao record ra locator rác / thiếu item?</b></summary>

Với multi-select `p:selectCheckboxMenu` (E.ON Policy Framework, Risk Category, Control...):
- ✅ **Chỉ click 1 lần** vào từng item — **không double-click** (Capture Bridge đã giữ panel sống, không bị AJAX re-render nuốt cú click đầu).
- ✅ Đóng menu bằng nút **Close của chính menu** — **đừng** click ra vùng nền để đóng, vì cú click nền sẽ bị codegen ghi thành locator rác kiểu `div.filter(...).nth(4)`.
- ✅ Capture Bridge gắn `role="option"` + accessible name ổn định → sinh `getByRole('option', { name })` bền thay cho `getByText(...).dblclick()`.
</details>

<details>
<summary><b>🌐 Chuyển môi trường dev ↔ qa1 như thế nào?</b></summary>

`npm run login qa1` — tự cập nhật `BASE_URL` trong `.env` và dùng session riêng của qa1. Thêm/sửa môi trường trong `config/environments.json`. Cần môi trường tạm thời? Truyền thẳng URL: `npm run login https://host/app`.
</details>

<details>
<summary><b>✏️ Sửa dữ liệu test mà không biết code?</b></summary>

Mở `tests/testcases/functions/TC-<KEY>.md`, sửa trong khối ```automation``` (đổi giá trị `fill...`, thêm `expect ... visible`, comment bước bằng `#`), rồi chạy `npm run md-to-spec <KEY>` (0 token). Trình biên dịch tự đối chiếu method với Page Object và báo lỗi nếu gõ sai tên.
</details>

<details>
<summary><b>🩹 Test đang xanh bỗng đỏ sau khi UI đổi?</b></summary>

Chạy `npm run heal <KEY>`: AI đọc trace/screenshot/selector đã thử, tự vá POM/Spec rồi chạy lại đến khi PASS. Có guardrail `tsc --noEmit` trước & sau — nếu AI làm hỏng cú pháp sẽ **tự động revert** về bản backup.
</details>

<details>
<summary><b>🎫 Lấy story từ Jira nhưng không có API token?</b></summary>

Client không cho tạo PAT → dùng session storage. Chạy `npm run login:jira -- <KEY>` 1 lần đầu ngày để lưu `.auth/jira.json`; sau đó mọi `fetch-ticket`/`qa` tái dùng phiên này, không bị hỏi lại MFA. `.auth/jira.json` chứa cookie nhạy cảm — đã `.gitignore`, **tuyệt đối không commit**.
</details>

---

<div align="center">

**Quy tắc vàng:** Selector **không bao giờ đoán mò** — Bắt đúng DOM thật từ thao tác, để AI tự động thiết kế và sinh mã kiểm thử. 🎭

</div>

