<div align="center">

# 🎭 QA-Playwright-ASAP

**E2E Test Automation cho E.ON Axon Ivy CyberSec Portal**
*Powered by Playwright + AI Copilot — Zero-Friction 1-Command Workflow*

`Record` → `Run` → `Self-Heal` · Một lệnh duy nhất cho mỗi tác vụ

</div>

---

## ⚡ Quick Start (3 bước — ~2 phút)

```bash
# 1️⃣  Cài đặt / Install
npm install
npx playwright install chromium

# 2️⃣  Tạo file môi trường / Setup credentials
cp .env.example .env        # → điền BASE_URL, TEST_USERNAME, TEST_PASSWORD

# 3️⃣  Đăng nhập & lưu session (chỉ 1 lần) / Save browser session (once)
npm run login
```

> ✅ Xong! Session được lưu ở `.auth/user.json`. Từ giờ mọi lệnh test đều tự dùng lại phiên đăng nhập này.

---

## 🚀 3 Chế độ chạy kiểm thử chính / 3 Core Test Modes

| # | Lệnh / Command | Tên gọi | Token | Trình duyệt | Dùng khi nào |
|:-:|:---|:---|:-:|:-:|:---|
| **1** | `npm run test:function <KEY>` | 🧩 **Native Deterministic** | 🟢 **0 Token** | Headed + SSO hand-off | CI/CD & kiểm thử hồi quy — tốc độ cao, ổn định 100% |
| **2** | `npm run test:agent <KEY>` | 🤖 **Autonomous AI Agent** | 🔵 AI CLI | Headed **full màn hình** | Điều hướng thông minh, tự suy luận DOM khi UI thay đổi |
| **3** | `npm run heal <KEY>` | 🩹 **Offline AI Self-Healing** | 🔵 AI CLI | — (offline) | Vá POM/Spec khi test **FAIL**, có guardrail revert an toàn |

### 🧩 Mode 1 — Native Deterministic
Chạy spec bằng code Playwright thuần, **không tốn token**, tốc độ cao. Có SSO/MFA hand-off tương tác cho tester khi cần.
```bash
npm run test:function CREATE_RISK_REQUEST
npm run test:function CREATE_RISK_REQUEST -- -g "01"      # lọc 1 kịch bản
npm run test:function CREATE_RISK_REQUEST -- --debug      # debug từng bước
```

### 🤖 Mode 2 — Autonomous AI Agent
Điều khiển trình duyệt trực quan (**headed full màn hình**) bằng AI Agent (GitHub Copilot CLI hoặc Claude CLI). Tự đọc DOM, suy luận và điều hướng thông minh dựa trên POM đã ground.
```bash
npm run test:agent CREATE_RISK_REQUEST
npm run test:agent CREATE_RISK_REQUEST -- --cli claude    # đổi CLI
npm run test:agent CREATE_RISK_REQUEST -- --slowmo 500
```

### 🩹 Mode 3 — Offline AI Self-Healing
Khi một testcase **FAIL**, Healer tự đọc `trace`, `screenshot`, `selector đã thử` từ `last-failure-context.json`, gọi AI CLI để vá trực tiếp file POM/Spec, rồi tự chạy lại đến khi PASS.
```bash
npm run heal CREATE_RISK_REQUEST
npm run heal SEC-11359 -- --no-retest
npm run heal CREATE_RISK_REQUEST -- --max-rounds=2 --cli=claude
```
> 🛡️ **Guardrail an toàn:** chạy `tsc --noEmit` **trước & sau** mỗi lần vá. Nếu AI làm hỏng cú pháp → **tự động REVERT** về bản backup, không để lan lỗi biên dịch.

---

## 🎬 Bộ công cụ Record 1-Click / 1-Click Recording

| Lệnh / Command | Mô tả |
|:---|:---|
| `npm run record:function <KEY>` | Record 1 business function tái sử dụng → tự sinh POM + Spec → tự verify |
| `npm run ticket <KEY>` | Pipeline trọn gói theo vé Jira: Fetch → Record → Sync → Test → Report |

### 🎯 PrimeFaces Capture Bridge (Layer 2)
Trình record tích hợp sẵn **Capture Bridge**, bắt trọn **100%** các thao tác PrimeFaces mà Codegen thường bỏ sót:
- ✅ Dropdown `p:selectOneMenu` — ghi lại đúng click chọn option trong overlay panel.
- ✅ Checkbox & radio button — gắn nhãn ổn định `data-stable-label`.
- ✅ Layer 1 DOM Annotator ổn định locator trước khi Recorder capture (version-agnostic).

```bash
npm run record:function CREATE_RISK_REQUEST
# → Tester thao tác trên browser → đóng lại → tự sinh POM + Spec + verify PASS/FAIL

npm run ticket SEC-11359
npm run ticket SEC-11359 -- --skip-record    # dùng recording sẵn có
npm run ticket SEC-11359 -- --headless       # verify chạy ẩn
```

---

## ✍️ Chỉnh sửa kịch bản qua Markdown (MD-to-Spec — 0 AI Token)

Sau khi record, kịch bản gốc được lưu thành file Markdown dễ đọc tại `tests/testcases/functions/TC-<KEY>.md`. **Tester hoàn toàn không cần biết code TypeScript** vẫn có thể chỉnh sửa dữ liệu, bổ sung assertions hoặc tạo kịch bản phụ (Negative test):

### 3 bước thực hiện:
1. **Mở file testcase:** `tests/testcases/functions/TC-<KEY>.md`
2. **Chỉnh sửa trực tiếp trong khối ```automation`:**
   - ✏️ **Đổi dữ liệu nhập:** `fillRiskTitleInput "Giá trị mới"`
   - 🔍 **Thêm kiểm tra (Assertion):** `expect nextButton visible`, `expect resultText text "Success"`
   - 🚫 **Bỏ qua bước:** Thêm dấu `#` ở đầu dòng (comment out).
   - ⏳ **Chờ / Tạm dừng:** `wait 2000` (chờ 2s) hoặc `pause` (dừng cho tester thao tác).
   - 🔄 **Kế thừa kịch bản cũ (Scenario Inheritance):** `include TC-<KEY>-01` để tái sử dụng 90% flow gốc và chỉ viết thêm các bước kiểm tra đặc thù.
3. **Biên dịch lại Spec tức thì (~0.2s — 0 Token):**
   ```bash
   npm run md-to-spec <KEY>
   # Ví dụ:
   npm run md-to-spec CREATE_RISK_REQUEST
   ```

> 🛡️ **Tự động bắt lỗi gõ nhầm (POM Introspection):** Trình biên dịch tự động đối chiếu các method với Page Object. Nếu Tester gõ sai tên method, script sẽ báo lỗi chi tiết từng dòng ngay lập tức, không để phát sinh lỗi ngầm.

---

## 🧹 Quản lý môi trường / Environment Management

| Lệnh / Command | Mô tả |
|:---|:---|
| `npm run clean:testcase` | Reset sạch testcase (recording, POM, spec, md) — **tự backup an toàn** vào `.backup_testcases/` trước khi xóa |
| `npm run clean` | Xóa `test-results`, `playwright-report`, `blob-report` |
| `npm run login:refresh` | Xóa session cũ & đăng nhập lại |

> 💾 `clean:testcase` luôn tạo bản backup có timestamp trước khi xóa — record lại từ đầu mà không sợ mất dữ liệu.

---

## 📋 Cheat Sheet — Bảng tra cứu lệnh

| Command | Chức năng |
|:---|:---|
| `npm run login` | Lưu session đăng nhập → `.auth/user.json` |
| `npm run login:refresh` | Xóa session cũ + đăng nhập lại |
| `npm run record:function <KEY>` | 🎬 Record function + auto POM/Spec + auto verify |
| `npm run ticket <KEY>` | 🎫 Pipeline Jira trọn gói (Fetch→Record→Sync→Test) |
| `npm run md-to-spec <KEY>` | ✍️ **Biên dịch .md thành Spec** (0 token, 0.2s, 0 AI) |
| `npm run test:function <KEY>` | 🧩 **Mode 1** — Native Deterministic (0 token) |
| `npm run test:agent <KEY>` | 🤖 **Mode 2** — Autonomous AI Agent |
| `npm run heal <KEY>` | 🩹 **Mode 3** — Offline AI Self-Healing |
| `npm run test:post-deploy` | Smoke test sau deploy: menu health + function chain |
| `npm run test:smoke` | Alias của `test:post-deploy` |
| `npm run clean:testcase` | 🧹 Reset testcase + backup an toàn |
| `npm run clean` | Xóa report & test-results |
| `npm run fetch-ticket <KEY>` | Lấy nội dung vé Jira → `docs/tickets/` |
| `npm run create-subtask <KEY>` | Tạo Jira test sub-task qua REST (0 token) |
| `npm run sync-specs <KEY>` | Sinh POM + Spec từ recording sẵn có |
| `npm run test:ui` · `test:debug` · `report` | Playwright UI mode / debug / mở HTML report |

---

## ⚙️ Cấu hình / Configuration

### `.env` — Biến môi trường
```dotenv
BASE_URL=https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec
TEST_USERNAME=your-username
TEST_PASSWORD=your-password

# Tùy chọn / Optional
SSO_TIMEOUT=120000        # thời gian chờ SSO/MFA thủ công (ms)
CODEGEN_VIEWPORT=         # trống = auto full màn hình (2K/Full HD)

# 🤖 AI Agent (Mode 2 & 3)
AI_AGENT_CLI=claude       # claude | copilot
AI_AGENT_FALLBACK=true    # tự fallback CLI còn lại khi hết quota
COPILOT_MODEL=claude-opus-4.8
AI_AGENT_TIMEOUT=60000
```

### `config/agent.json` — Cấu hình AI CLI
```json
{
  "defaultCli": "copilot",
  "autoFallback": true,
  "timeoutMs": 60000,
  "copilot": { "model": "claude-opus-4.8", "flags": ["--allow-all"] },
  "claude":  { "flags": ["--print", "--dangerously-skip-permissions"] },
  "logDir": "logs/agent-runs"
}
```

---

## 🗂️ Cấu trúc dự án / Project Structure

```
QA-Playwright-ASAP/
├── config/
│   ├── agent.json                 # Cấu hình AI Agent (Mode 2 & 3)
│   └── post-deploy-smoke.json     # Chuỗi function cho smoke test
├── docs/
│   ├── specs/codebase/            # Grounded components (YAML)
│   └── tickets/                   # Vé Jira đã fetch (<KEY>.md)
├── scripts/
│   ├── ticket-pipeline.js         # 🎫 1-command Jira pipeline
│   ├── record-ticket.js           # 🎬 Codegen + PrimeFaces Capture Bridge
│   ├── run-function.js            # 🧩 Mode 1 — Native Deterministic
│   ├── run-agent.js               # 🤖 Mode 2 — Autonomous AI Agent
│   ├── ai-healer.js               # 🩹 Mode 3 — Offline Self-Healing
│   ├── clean-testcases.js         # 🧹 Reset + backup
│   ├── sync-specs.js              # POM + Spec generator (Reverse-Grounding)
│   └── login.js                   # Session saver
├── tests/
│   ├── e2e/functions/             # Specs: TC-<KEY>.spec.ts
│   ├── pages/functions/           # Page Object Models: <Name>Page.ts
│   ├── recordings/functions/      # Codegen recordings
│   └── testcases/functions/       # Mô tả testcase (.md)
├── .env.example
└── playwright.config.ts
```

---

## 🔬 Cách hoạt động / How It Works

**Grounding & Reverse-Grounding** — Selector **không bao giờ được đoán mò**:
- **Forward:** Playwright Codegen ghi lại click/fill thật trên app + PrimeFaces Capture Bridge.
- **Reverse-Grounding:** `sync-specs` trích selector thật vào `live_grounded_components.yaml` → các vé sau tự tái sử dụng selector đã verify.

```
Record ──► Sync (POM+Spec) ──► Run (Mode 1/2) ──► FAIL? ──► Heal (Mode 3) ──► PASS ✅
```

---

## 📚 References

- [Microsoft Playwright](https://github.com/microsoft/playwright) — E2E framework & Codegen
- [OpenSpec (Fission AI)](https://github.com/Fission-AI/OpenSpec) — YAML spec standard cho Agentic workflow
- [Stagehand (Browserbase)](https://github.com/browserbase/stagehand) — AI browser agent trên Playwright
