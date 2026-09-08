---
name: analyze-story
description: "[Model tier: claude-opus-4.8 (default); hạ xuống claude-sonnet-5 qua AUTO_TEST_ANALYSIS_MODEL hoặc --sonnet/--model khi cần] Phân tích chuyên sâu Jira Story TRƯỚC khi sinh test — đọc file tóm tắt docs/tickets/<KEY>.summary.json (đã được /summarize-story cô đọng) rồi chạy Conflict Detection Checklist đối chiếu Description vs AC vs Codebase Specs, chặn Blocker trước khi /new-test chạy"
---

# Lệnh /analyze-story: Phân Tích & Phát Hiện Xung Đột Story (Pre-flight trước /new-test)

Bạn là QA Business Analyst kiêm QA Automation Engineer cao cấp. Nhiệm vụ: dùng khả năng suy luận sâu để phân loại xem 1 Jira Story **AN TOÀN để sinh test** hay **có xung đột cần dừng lại hỏi PO/Tester**.

> Đây là bước **BẮT BUỘC chạy trước** `/new-test` với bất kỳ Jira Story nào có đính kèm ảnh/diagram hoặc mô tả nghiệp vụ phức tạp. `/new-test` sẽ tham chiếu ngược lại kết quả của lệnh này.

## 🏗️ KIẾN TRÚC PHÂN TẦNG MODEL (ĐỌC TRƯỚC KHI THỰC THI)
Lệnh này chạy ở model mặc định (`claude-opus-4.8` — tận dụng chiều sâu suy luận và khả năng giải quyết logic phức tạp của dòng Opus, vẫn tối ưu chi phí vì chỉ đọc bản tóm tắt `summary.json` tinh gọn (~30k tokens) thay vì raw context) và **ưu tiên đọc `docs/tickets/<KEY>.summary.json`** — file đã được `/summarize-story` trích xuất và cô đọng sẵn: ghi chú ảnh/diagram, comment resolution, kết quả tra `ui_components.yaml`/`state_machine.yaml`, và bản tóm tắt Description/AC/Implementation Hint kèm số lượng task/step từng mục.

> 🔁 **Cần hạ xuống model rẻ hơn?** Có thể chuyển sang `claude-sonnet-5` bất kỳ lúc nào (ticket đơn giản, muốn tiết kiệm chi phí) qua biến môi trường `AUTO_TEST_ANALYSIS_MODEL=claude-sonnet-5`, hoặc cờ dòng lệnh khi chạy pipeline: `npm run auto-test KFWT-1161 -- --sonnet` (hoặc `--model claude-sonnet-5`). Khi chạy `/analyze-story` độc lập qua Copilot CLI: `copilot --model claude-sonnet-5 -p "..."`.

- **Nếu `docs/tickets/<KEY>.summary.json` đã tồn tại**: dùng nó làm nguồn dữ liệu chính cho toàn bộ các bước dưới đây — KHÔNG mở lại ảnh gốc/2 file YAML đầy đủ để tiết kiệm token, TRỪ KHI dữ liệu trong summary JSON thiếu chi tiết cụ thể bạn thực sự cần để kết luận (khi đó mới mở đúng file gốc liên quan, không đọc toàn bộ).
- **Nếu file summary chưa tồn tại** (chạy `/analyze-story` độc lập, không qua pipeline `npm run auto-test`): tự thực hiện lại Bước 1/1B/2 bên dưới như một fallback đầy đủ trước khi sang Bước 3.

## 🌐 QUY CHUẨN NGÔN NGỮ BẮT BUỘC — 100% TIẾNG ANH CHO MỌI FILE SINH RA
Nếu kết quả phân tích của lệnh này được ghi ra file (testcase `.md` trong `tests/testcases/`, hoặc bất kỳ artefact nào sẽ được `/new-test` dùng để sinh `.spec.ts`/`.ts`), toàn bộ nội dung ghi ra file — bao gồm **Bảng Câu Hỏi gửi PO/Tester**, mô tả xung đột, chú thích `// ⚠️ ASSUMPTION:` — **PHẢI viết 100% bằng Tiếng Anh chuyên nghiệp (English only)**, giữ nguyên thuật ngữ kỹ thuật/nghiệp vụ gốc của E.ON/Jira/Confluence (kể cả nhãn UI tiếng Đức thật trên app). TUYỆT ĐỐI KHÔNG dịch sang Tiếng Việt trong các file đó để tránh sai lệch ngữ cảnh domain. Phần trả lời tương tác trực tiếp với Tester trong hội thoại vẫn có thể dùng Tiếng Việt.

---

## 🖼️ BƯỚC 1 — MULTIMODAL INSPECTION (FALLBACK — CHỈ CHẠY NẾU CHƯA CÓ `summary.json`, BẮT BUỘC, KHÔNG ĐƯỢC BỎ QUA)

Trước khi đọc bất kỳ dòng text nào của Description/AC, bạn **BẮT BUỘC phải mở và quan sát bằng mắt (multimodal)** toàn bộ ảnh liên quan tới story:

1. Mọi ảnh trong `docs/tickets/<KEY>/attachments/` (mockup, ảnh chụp màn hình do PO/BA đính kèm trong Description/AC gốc).
2. Mọi ảnh trong `docs/tickets/<KEY>/screenshots/` (diagram draw.io/gliffy/canvas/iframe đã được tự động chụp, và `full-page.png` chụp toàn trang ticket).
3. Với mỗi ảnh, ghi chú lại: ảnh này thể hiện **field nào, thứ tự bước nào, trạng thái/luồng rẽ nhánh nào, hay validation rule nào** — đây chính là nguồn sự thật trực quan, thường chi tiết hơn text mô tả.

> Nếu thư mục `attachments/` hoặc `screenshots/` không tồn tại/rỗng, ghi rõ "Không có ảnh đính kèm — phân tích chỉ dựa trên text" và tiếp tục Bước 2.

---

## 💬 BƯỚC 1B — COMMENT RESOLUTION AUTHORITY (FALLBACK NẾU CHƯA CÓ `summary.json` — nếu đã có, đọc trực tiếp `comments.resolvedConflicts`/`comments.openQuestions` trong file JSON; BẮT BUỘC ĐỌC TRƯỚC KHI KẾT LUẬN BLOCKER)

Nếu `docs/tickets/<KEY>.md` có mục `## 💬 Jira Comments & Discussion`, đây là nguồn đặc tả bổ sung có **thẩm quyền cao nhất (Resolution Authority)** — vì nó phản ánh **thỏa thuận mới nhất, trực tiếp giữa PO và Dev** để làm rõ các mâu thuẫn nghiệp vụ (vd tranh luận "1 task vs 2 task" trong KFWT-1161), trong khi Description/AC gốc thường **không được PO/Dev quay lại cập nhật** sau khi đã chốt trong Comment.

Quy tắc đọc Comments:
1. Đọc toàn bộ Comments theo đúng **thứ tự thời gian** (timestamp tăng dần) — thỏa thuận chốt sau cùng luôn được ưu tiên nếu có nhiều comment tranh luận qua lại về cùng 1 điểm.
2. Với mỗi mâu thuẫn phát hiện được ở Bước 3 (Description ⇄ AC ⇄ codebase ⇄ ảnh), **bắt buộc kiểm tra ngược lại xem Comments có đề cập và chốt phương án cho đúng điểm đó không** trước khi xếp vào Blocker.
3. Một comment được coi là **"Resolved"** (đã chốt) khi nó đáp ứng CẢ HAI điều kiện:
   - Tác giả là PO/BA hoặc Dev phụ trách ticket (đối chiếu với `Reporter`/`Assignee` trong bảng thuộc tính, hoặc người có phát biểu mang tính quyết định "chốt là...", "sẽ làm...", "confirm...", "OK, sẽ..." — không phải câu hỏi/nghi vấn còn bỏ ngỏ).
   - Nội dung **trả lời trực tiếp và rõ ràng** đúng điểm mâu thuẫn đang xét (không chỉ nhắc chung chung).
4. Nếu một mâu thuẫn đã **"Resolved" trong Comment** → **KHÔNG còn tính là Blocker nữa**, hạ xuống mức tương đương Warning: vẫn sinh test được, nhưng bắt buộc:
   - Lấy chính xác phương án đã chốt trong Comment làm căn cứ sinh testcase/spec (KHÔNG dùng lại phương án cũ trong Description/AC nếu đã bị Comment thay thế).
   - Chèn chú thích `// ⚠️ ASSUMPTION: Resolved via Jira Comment (#<author>, <ngày>) — <tóm tắt phương án đã chốt>` ngay tại vị trí liên quan khi `/new-test` sinh code.
   - Ghi rõ trong phần "Kết luận phân loại" ở Bước Đầu Ra: mục nào đã được hạ từ Blocker xuống nhờ Comment, trích dẫn đúng tác giả + thời gian comment đó.
5. Nếu Comment chỉ đặt câu hỏi/nghi vấn nhưng **chưa có câu trả lời chốt** (còn bỏ ngỏ, hoặc người trả lời không phải PO/Dev phụ trách) → **KHÔNG được coi là Resolved**, vẫn giữ nguyên mức Blocker như bình thường và đưa luôn câu hỏi còn bỏ ngỏ đó vào Bảng Câu Hỏi gửi PO/Tester (tránh hỏi lại câu đã hỏi trong Comment).
6. Nếu ticket không có mục Comments (chưa đồng bộ hoặc ticket không có comment nào) → ghi rõ "Không có Jira Comments — phân tích chỉ dựa trên Description/AC/Codebase Specs/ảnh" và tiếp tục các bước còn lại như bình thường.

---

## 📚 BƯỚC 2 — GROUNDING VÀO CODEBASE SPECS (FALLBACK NẾU CHƯA CÓ `summary.json` — nếu đã có, đọc trực tiếp `codebaseGrounding.dialogsMatched`/`processesMatched`/`notFound`; KHÔNG ĐOÁN)

Đối chiếu nội dung Story với **bằng chứng thật từ mã nguồn** đã được bóc tách sẵn tại `docs/specs/codebase/` (sinh bởi `npm run generate-codebase-specs`):

- `docs/specs/codebase/ui_components.yaml`: tra đúng `dialogs[].name` liên quan tới màn hình được nhắc trong Story → lấy chính xác `id`, `type` (PrimeFaces component), `label`, `required`, `valueBinding` của từng field. **Đây là nguồn duy nhất được phép dùng để khẳng định 1 field tồn tại/loại gì/bắt buộc hay không.**
- `docs/specs/codebase/state_machine.yaml`: tra đúng `processes[].tasks`/`transitions` liên quan → xác nhận task/vai trò (`responsibleRole`)/điều kiện rẽ nhánh (`conditions`) Story mô tả có khớp với process thật đang chạy hay không.
- Nếu tra không thấy dialog/process liên quan trong 2 file trên → không suy diễn, ghi nhận "Không tìm thấy trong codebase specs" và coi là rủi ro cần liệt kê ở Bước 3.

---

## ⚖️ BƯỚC 3 — CONFLICT DETECTION CHECKLIST (BƯỚC SUY LUẬN CHÍNH — LUÔN CHẠY, DÙ ĐÃ CÓ `summary.json` HAY KHÔNG)

So khớp chéo 3 nguồn: **Description ⇄ Acceptance Criteria (AC) ⇄ `docs/specs/codebase/`** (và ảnh ở Bước 1). Nếu đã có `docs/tickets/<KEY>.summary.json`, dùng `storyDigest.descriptionSummary`, `storyDigest.acceptanceCriteria`, `storyDigest.implementationHint`, `storyDigest.taskStepCounts` và `codebaseGrounding.*` làm nguồn so khớp chính. Với mỗi điểm không khớp, phân vào đúng 1 trong 2 mức sau — **nhưng trước khi kết luận Blocker, luôn áp dụng Bước 1B (Comment Resolution Authority) để kiểm tra xem mâu thuẫn đó đã được PO/Dev chốt trong Comment chưa.**

> **Bước bắt buộc trước khi phân loại**: đối chiếu `storyDigest.taskStepCounts` (nếu có `summary.json`) hoặc tự liệt kê rõ **danh sách task/step theo thứ tự** được nhắc tới ở TỪNG mục của story (Description, AC, Implementation Hint/Dev Notes nếu có) thành 1 bảng đếm số lượng. Nếu số lượng/tên/thứ tự task không khớp nhau giữa các mục → áp dụng ngay quy tắc Blocker "Số lượng task/step khác nhau" bên dưới, không được tự gộp/suy luận rằng 2 cách mô tả nói về cùng 1 thứ.

### 🔴 Mức BLOCKER (dừng lại ngay, KHÔNG sinh `.spec.ts`)
Áp dụng khi xung đột có thể khiến test sai lệch nghiệp vụ nghiêm trọng hoặc không thể tự suy luận an toàn:
- Description và AC **mâu thuẫn trực tiếp** (vd: Description nói field A optional, AC nói field A bắt buộc phải nhập).
- Field/label/nút được Story nhắc tới **không tồn tại** trong `ui_components.yaml` ở dialog tương ứng (có khả năng Story mô tả màn hình đã đổi tên/field đã bị xoá).
- Trạng thái/luồng rẽ nhánh Story mô tả **không khớp** `conditions`/`tasks` trong `state_machine.yaml` (vd: Story nói "chuyển sang bước X" nhưng state machine không có transition nào dẫn tới X từ bước hiện tại).
- Ảnh mockup/diagram (Bước 1) **mâu thuẫn** với mô tả text (vd: ảnh cho thấy 3 bước nhưng AC chỉ liệt kê 2 bước, hoặc field trong ảnh có tên khác field trong text).
- Vai trò (role) thực hiện task theo Story khác với `responsibleRole` thực tế trong `state_machine.yaml`.
- **Số lượng task/step khác nhau giữa các mục trong CÙNG 1 story** (vd: "Acceptance Criteria" mô tả 1 task, nhưng "Implementation Hint"/"Dev Notes"/"Technical Notes" mô tả 2 task; hoặc chính AC tự mâu thuẫn nội bộ — mở đầu nói "a new task" số ít nhưng đoạn sau lại nhắc "the first task"/"the second task"). **KHÔNG được coi "Implementation Hint" là phụ lục kém quan trọng hơn AC** — đây là 1 nguồn spec ngang hàng, nếu số lượng task/thứ tự bước/điều kiện field (mandatory/disabled) giữa 2 mục lệch nhau thì đây LUÔN LÀ BLOCKER, kể cả khi ảnh/diagram khớp với 1 trong 2 mục còn lại. Diagram khớp AC không đủ để hạ cấp xung đột này xuống Warning, vì 1 node diagram dạng **collapsed sub-process** (có icon `+`/expand ở góc) có thể ẩn nhiều task con bên trong — phải nêu rõ nghi vấn này trong Bảng Câu Hỏi thay vì tự suy đoán "diagram = số task thật".
- Trước khi hạ 1 phát hiện xuống mức Warning vì lý do "chỉ là chi tiết bổ sung, không mâu thuẫn": bắt buộc tự hỏi "phát hiện này có làm thay đổi **số bước test, điều kiện mandatory/disabled của field, hoặc điểm rẽ nhánh** trong testcase không?" — nếu có, đây là Blocker chứ không phải Warning, dù mức độ nghe có vẻ nhỏ.

→ Khi gặp Blocker: **DỪNG LẠI**, không sinh testcase/spec.ts. Xuất **Bảng Câu Hỏi gửi PO/Tester** theo mẫu:

| # | Vị trí phát hiện | Mô tả xung đột | Câu hỏi cần PO/Tester xác nhận |
| :-: | :--- | :--- | :--- |
| 1 | Description (dòng ...) vs AC (mục ...) | ... | ... |

### 🟡 Mức WARNING (vẫn sinh test, nhưng phải chú thích rõ)
Áp dụng khi có sự **không chắc chắn nhỏ** nhưng có thể suy luận hợp lý để tiếp tục:
- Story không nói rõ 1 chi tiết (vd: định dạng ngày, giá trị mặc định) nhưng `ui_components.yaml`/ảnh mockup gợi ý đủ để suy luận.
- Field tồn tại trong codebase nhưng `required` trong `ui_components.yaml` khác với suy đoán ban đầu từ text — dùng giá trị `required` thật từ YAML, không dùng suy đoán.
- Diagram/ảnh có chi tiết bổ sung nhỏ không mâu thuẫn với text, chỉ làm rõ thêm.

→ Khi gặp Warning: **vẫn cho phép sinh test**, nhưng bắt buộc chèn dòng chú thích ngay tại vị trí liên quan trong `.spec.ts`:
```ts
// ⚠️ ASSUMPTION: <mô tả rõ giả định đã dùng và vì sao, tham chiếu nguồn: ui_components.yaml / ảnh mockup nào>
```

---

## 📤 ĐẦU RA YÊU CẦU

1. **Tóm tắt Multimodal Inspection**: liệt kê từng ảnh đã xem + ghi chú rút ra.
2. **Tóm tắt Comment Resolution Authority**: liệt kê các mâu thuẫn (nếu có) đã được PO/Dev chốt trong Comment (trích tác giả + thời gian + phương án chốt), và các câu hỏi trong Comment còn bỏ ngỏ chưa có trả lời chốt.
3. **Bảng tra cứu Codebase Specs**: dialog/process nào đã tra trong `ui_components.yaml`/`state_machine.yaml`, kết quả tra được.
4. **Kết luận phân loại**:
   - Nếu có ít nhất 1 Blocker (sau khi đã loại trừ các mục đã Resolved qua Comment) → chỉ xuất **Bảng Câu Hỏi gửi PO/Tester**, ghi rõ dòng: `🔴 STORY BỊ CHẶN — chưa sinh testcase/spec.ts cho tới khi PO/Tester xác nhận các câu hỏi trên.`
   - Nếu không có Blocker (có thể có Warning, bao gồm cả các mục đã hạ cấp nhờ Comment) → ghi rõ dòng: `🟢 STORY AN TOÀN ĐỂ SINH TEST` kèm danh sách các Warning cần chèn `// ⚠️ ASSUMPTION:` khi chạy `/new-test`.
