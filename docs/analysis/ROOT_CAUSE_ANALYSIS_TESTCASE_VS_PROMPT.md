# 🔍 Phân Tích Gốc Rễ: "Chạy Theo Testcase Fail Liên Tục, Dùng Prompt Lại Hiệu Quả Hơn"

> Phân tích phản hồi của Tester đối chiếu với framework hiện tại (`QA-Playwright-Copilot-Starter`)
> và giải pháp cải tiến triệt để về framework + prompt.

## 1. Tóm Tắt Phản Hồi & Kết Luận Nhanh

**Phản hồi tester:** *"Chạy theo testcase thì fail liên tục, còn dùng prompt yêu cầu test thì chạy hiệu quả hơn — chạy theo test[case] rời xa thực tế hơn prompt."*

**Kết luận:** Đây **không phải** lỗi Playwright hay lỗi ngẫu nhiên. 2 testcase demo (`TC-TODO-01/02`) vẫn PASS vì đã được "may đo" sẵn `TodoPage.ts` đúng với app TodoMVC. Vấn đề bùng phát khi tester đưa **feature/testcase mới**: prompt `/new-test` yêu cầu AI sinh code **chỉ từ văn bản testcase Given/When/Then**, **không quan sát app thật** → AI **đoán** selector, text, số lượng phần tử → sai → fail liên tục.

Ngược lại, khi tester "dùng prompt tự do" (thường kèm record hoặc MCP tương tác trực tiếp với web), AI **nhìn thấy DOM thật** → bám thực tế → hiệu quả hơn. Đó chính xác là cảm giác *"testcase rời xa thực tế hơn prompt"*.

## 2. Nguyên Nhân Gốc Rễ (Root Causes)

| # | Nguyên nhân gốc | Bằng chứng trong repo | Hệ quả |
|---|---|---|---|
| **R1** | **Không grounding vào app thật.** `/new-test` dịch testcase → code, đầu ra ghi *"bấm F5 chạy ngay không cần chỉnh sửa"* nhưng không có bước quan sát DOM. | `new-test.prompt.md` (bản cũ), phần "ĐẦU RA YÊU CẦU". | AI bịa `getByRole/getByLabel` không tồn tại → fail ngay lần đầu. |
| **R2** | **Chủ đích bỏ MCP để tiết kiệm token** — nhưng chính MCP là thứ tạo "grounding" khiến prompt-mode hiệu quả. | `docs/QA_PLAYWRIGHT_OPTIMIZATION_PLAN.md` mục 2 & 6 (giảm ~97% token bằng cách bỏ tương tác từng bước). | Đánh đổi độ chính xác lấy chi phí token → test rời thực tế. |
| **R3** | **Testcase quá mỏng.** Template `.md` chỉ có Given/When/Then, không có gợi ý UI, tên nút/nhãn, testid, test data. | `tests/testcases/TC-TODO-01-add-todo.md`. | AI thiếu dữ kiện → buộc phải đoán. |
| **R4** | **Không ràng buộc tái sử dụng Page Object.** Prompt không bắt AI chỉ dùng locator/method đã khai báo trong `tests/pages/`. | `new-test.prompt.md` không nhắc POM; spec mẫu khởi tạo POM sẵn nên "may mắn" đúng. | Feature mới không có POM → AI tự chế selector. |
| **R5** | **Guardrail hiểu sai bản chất lỗi.** `/fix-failed-test` mặc định *"web hiển thị sai Expected → BUG WEB, giữ FAIL"*, không phân biệt test **chưa từng xanh** (lỗi tác giả) với test **từng xanh nay đỏ** (regression). | `fix-failed-test.prompt.md` (bản cũ), mục Guardrail. | Test bịa sai bị quy oan thành "bug web" → tester ngập bug giả, càng thấy vô dụng. |
| **R6** | **Cấm sửa assertion tuyệt đối** kể cả khi bản dịch Expected Result ban đầu bị sai (vd "hiển thị 1 việc" → `toHaveCount(1)` trong khi app có item mặc định). | Guardrail quy tắc 1 (bản cũ). | Lỗi dịch nghiệp vụ bị khóa cứng ở trạng thái FAIL. |
| **R7** | **Thiếu ổn định/tái lập.** Không có `beforeEach` reset trạng thái, precondition ("đã có 1 việc") không được tạo tường minh, dễ phụ thuộc localStorage. | Spec mẫu tự tạo data trong bước Given (ổn), nhưng prompt không bắt buộc pattern này cho test mới. | Flaky → cảm giác "fail liên tục". |

**Gốc rễ sâu nhất (R1+R2):** framework tối ưu token bằng cách **tách AI khỏi thực tế app**. Testcase-First đúng về *kỷ luật truy vết*, nhưng khi thiếu *grounding*, nó biến thành "viết mù". Prompt-mode thắng vì nó có grounding.

## 3. Giải Pháp Cải Tiến (Đã Triển Khai Trong Repo)

Nguyên tắc: **giữ kỷ luật Testcase-First, nhưng bơm "thực tế" trở lại vòng sinh test** — grounding có kiểm soát, không đốt token vô tội vạ.

### 3.1. `/new-test` mới — "Cấm đoán, phải grounding" (giải R1, R4, R7)
- Thêm **Nguyên tắc số 1**: trước khi viết locator, phải lấy selector từ **nguồn thật** theo thứ tự: (1) Page Object đã có → (2) code record → (3) MCP/trình duyệt → (4) nếu không có nguồn nào thì **KHÔNG bịa**, mà đánh dấu `// ⚠️ CHƯA GROUNDED` và yêu cầu tester xác thực.
- Bắt buộc **tái sử dụng Page Object**, cấm gọi method/selector không tồn tại.
- Bắt buộc `beforeEach` reset trạng thái + tạo precondition tường minh + tách test data.
- Thêm **checklist tự kiểm chứng** và khuyến nghị chạy để đạt **first-green** trước khi bàn giao.

### 3.2. `/ground-page` mới — Grounding Page Object từ app thật (giải R1, R2, R4)
Lệnh chuyên tạo/cập nhật Page Object **chỉ từ selector thật** (record / pick-locator / MCP / DOM snapshot). Đây là "cầu nối thực tế" thay cho việc bật MCP toàn thời gian: chỉ tốn token 1 lần để chốt selector, sau đó `/new-test` tái sử dụng miễn phí.

### 3.3. `/fix-failed-test` mới — Baseline Gate (giải R5, R6)
- Thêm **Bước 0 – Baseline Gate**: test **chưa từng xanh** ⇒ mặc định là **lỗi tác giả kịch bản**, sửa/ground lại, **chưa được xuất Bug Report**. Chỉ test **từng xanh nay đỏ** mới vào luồng nghi bug web.
- Phân biệt rõ **"sửa đúng kỳ vọng"** (được phép, khi bản dịch Expected sai) với **"ép PASS"** (cấm). Gỡ thế khóa cứng của R6.

### 3.4. Template testcase giàu ngữ cảnh (giải R3)
`tests/testcases/_TEMPLATE.md` bổ sung: **Gợi ý UI thật** (tên nút/nhãn/testid + gợi ý locator), **Test Data** (giá trị nhập & giá trị assert chính xác), **Page Object liên quan**, liên kết requirement. Testcase càng giàu → AI càng ít đoán.

## 4. Ánh Xạ Workflow Tester → Điểm Cải Tiến

| Bước workflow tester | Rủi ro cũ | Sau cải tiến |
|---|---|---|
| req → review business → check gap | — | Không đổi |
| viết test scenario | Scenario mỏng → AI đoán | Dùng `_TEMPLATE.md` giàu gợi ý UI/data |
| build auto framework (người build trước) | POM lệch app / thiếu | `/ground-page` tạo POM từ app thật |
| **AI build test mới** | `/new-test` bịa selector | `/new-test` grounding + tái dùng POM + first-green |
| run test | Fail liên tục vì đoán sai | Xanh ngay nếu grounded; nếu đỏ có nhãn CHƯA GROUNDED |
| create bug | Bug giả từ test chưa từng xanh | Baseline Gate chặn bug giả, chỉ báo bug thật |

## 5. Khuyến Nghị Vận Hành (Quy Trình Hybrid Đề Xuất)

1. **Ground trước, sinh sau:** với feature mới, chạy `Record new`/`Pick locator` hoặc `/ground-page` để chốt Page Object → rồi `/new-test`.
2. **Cổng First-Green:** một testcase chỉ được coi là "đáng tin để bắt bug" sau khi đã **xanh thật ít nhất 1 lần**. Trước đó, mọi FAIL là việc của tester/AI, không phải của Dev.
3. **Testcase-First cho regression, Prompt+Record cho khám phá:** dùng prompt/record để khám phá UI mới (bám thực tế), sau đó "đóng băng" thành testcase + spec đã grounded để chạy lặp lại ổn định.
4. **Cân bằng token:** không cần MCP mọi lúc — chỉ dùng khi grounding Page Object lần đầu; chi phí token 1 lần, lợi ích tái sử dụng lâu dài.

## 6. Tệp Đã Thay Đổi/Thêm

- `.github/prompts/new-test.prompt.md` — viết lại: grounding + tái dùng POM + tự kiểm chứng.
- `.github/prompts/fix-failed-test.prompt.md` — viết lại: Baseline Gate + phân biệt sửa-đúng-kỳ-vọng vs ép-PASS.
- `.github/prompts/ground-page.prompt.md` — **mới**: grounding Page Object từ app thật.
- `tests/testcases/_TEMPLATE.md` — **mới**: template testcase giàu ngữ cảnh.
- `docs/ROOT_CAUSE_ANALYSIS_TESTCASE_VS_PROMPT.md` — tài liệu này.
