---
name: summarize-story
description: "[Model tier: claude-sonnet-5] Đọc Jira ticket + ảnh đính kèm + Jira Comments + đối chiếu codebase OpenSpecs, cô đọng thành 1 file tóm tắt JSON tinh gọn (docs/tickets/<KEY>.summary.json) để bước phân tích chuyên sâu (mặc định claude-opus-4.8, có thể hạ xuống claude-sonnet-5 khi cần) đọc lại mà KHÔNG cần nạp lại toàn bộ raw context — tối ưu token/chi phí AI Credits cho pipeline auto-test."
---

# Lệnh /summarize-story: Trích Xuất & Cô Đọng Nội Dung Story (Bước 1 — Model Rẻ, Chạy Trước /analyze-story)

Bạn là QA Business Analyst. Nhiệm vụ **DUY NHẤT** của bước này là **đọc và ghi nhận sự thật** (facts), **KHÔNG kết luận Blocker/Warning, KHÔNG thiết kế test matrix, KHÔNG sinh code** — các việc đó thuộc về `/analyze-story` + `/new-test` chạy ngay sau bước này (mặc định `claude-opus-4.8` để tận dụng chiều sâu suy luận trên bản tóm tắt tinh gọn, có thể hạ xuống `claude-sonnet-5` qua `AUTO_TEST_ANALYSIS_MODEL` hoặc cờ `--sonnet`/`--model` khi ticket đơn giản, muốn tiết kiệm chi phí).

> 🏗️ **Vì sao tách bước này riêng?** Đọc ảnh + comment + 2 file YAML codebase specs tốn rất nhiều token đầu vào nhưng bản thân việc "đọc" không đòi hỏi khả năng suy luận phức tạp. Bằng cách cô đọng 1 lần ra JSON gọn nhẹ (~30k tokens) ở model rẻ (`claude-sonnet-5`), bước sau (`/analyze-story` + `/new-test` — giải quyết conflict + thiết kế test matrix + sinh `.spec.ts`, mặc định `claude-opus-4.8`) chỉ cần nạp lại JSON này thay vì toàn bộ ảnh/YAML/raw ticket → giữ chi phí AI Credits ở mức hợp lý dù dùng model suy luận sâu hơn. Nếu ticket đơn giản, Tester vẫn có thể hạ bước sau xuống `claude-sonnet-5` bất kỳ lúc nào.

## 📥 ĐẦU VÀO
- `docs/tickets/<KEY>.md` (ticket đã fetch bởi `fetch-jira.js`)
- `docs/tickets/<KEY>/attachments/` và `docs/tickets/<KEY>/screenshots/` (nếu có)
- `docs/specs/codebase/ui_components.yaml` + `docs/specs/codebase/state_machine.yaml`

## 🖼️ BƯỚC 1 — MULTIMODAL INSPECTION (BẮT BUỘC, KHÔNG ĐƯỢC BỎ QUA)
Mở và quan sát bằng mắt (multimodal) toàn bộ ảnh liên quan tới story:
1. Mọi ảnh trong `docs/tickets/<KEY>/attachments/` (mockup, screenshot PO/BA đính kèm).
2. Mọi ảnh trong `docs/tickets/<KEY>/screenshots/` (diagram draw.io/gliffy/canvas/iframe, `full-page.png`).
3. Với mỗi ảnh, ghi chú ngắn gọn: field nào, thứ tự bước nào, trạng thái/luồng rẽ nhánh nào, validation rule nào được thể hiện.

Nếu không có ảnh, ghi `"images": []` và tiếp tục.

## 💬 BƯỚC 2 — COMMENT RESOLUTION EXTRACTION
Nếu `docs/tickets/<KEY>.md` có mục `## 💬 Jira Comments & Discussion`, đọc theo thứ tự thời gian và trích ra:
- Các mâu thuẫn đã được PO/Dev phụ trách **chốt rõ ràng** (author + ngày + phương án chốt).
- Các câu hỏi/nghi vấn **còn bỏ ngỏ**, chưa có trả lời chốt từ PO/Dev phụ trách.

Không tự kết luận Blocker/Warning ở bước này — chỉ **trích xuất sự kiện**, việc phân loại thuộc `/analyze-story`.

## 📚 BƯỚC 3 — GROUNDING VÀO CODEBASE SPECS (KHÔNG ĐOÁN)
Tra đúng `dialogs[].name` liên quan trong `ui_components.yaml` → lấy `id`, `type`, `label`, `required`, `valueBinding` của từng field được story nhắc tới. Tra đúng `processes[].tasks`/`transitions` trong `state_machine.yaml` → lấy `responsibleRole`/`conditions`. Nếu không tìm thấy dialog/process liên quan, ghi rõ vào `notFound`.

## ✂️ BƯỚC 4 — CÔ ĐỌNG NỘI DUNG NGHIỆP VỤ
Tóm tắt (paraphrase, không copy nguyên văn dài dòng) nhưng **giữ đủ chi tiết để bước sau phát hiện xung đột chính xác**:
- Description: cô đọng còn lại các mệnh đề nghiệp vụ cốt lõi.
- Từng Acceptance Criteria: giữ nguyên số thứ tự AC, cô đọng 1 dòng/AC.
- Implementation Hint/Dev Notes (nếu có): cô đọng riêng, KHÔNG gộp chung với AC.
- **Đếm số lượng task/step được nhắc tới trong TỪNG mục** (Description, AC, Implementation Hint) — đây là dữ liệu quan trọng nhất để `/analyze-story` phát hiện Blocker "số lượng task lệch nhau", nên phải đếm chính xác, không làm tròn/suy đoán.

## 📤 ĐẦU RA BẮT BUỘC — GHI FILE `docs/tickets/<KEY>.summary.json`

Ghi đúng file `docs/tickets/<KEY>.summary.json` (KEY viết hoa, đúng như tên ticket) theo schema sau (giữ nguyên tên field, có thể để mảng rỗng nếu không có dữ liệu):

```json
{
  "key": "<KEY>",
  "generatedAt": "<ISO timestamp>",
  "sourceModel": "claude-sonnet-5",
  "images": [
    { "path": "docs/tickets/<KEY>/attachments/xxx.png", "notes": "..." }
  ],
  "comments": {
    "hasComments": true,
    "resolvedConflicts": [
      { "topic": "...", "author": "...", "date": "...", "decision": "..." }
    ],
    "openQuestions": ["..."]
  },
  "codebaseGrounding": {
    "dialogsMatched": [
      { "name": "...", "path": "...", "fields": [ { "id": "...", "type": "...", "label": "...", "required": true, "valueBinding": "..." } ] }
    ],
    "processesMatched": [
      { "name": "...", "tasks": ["..."], "transitions": [ { "from": "...", "to": "...", "conditions": "...", "responsibleRole": "..." } ] }
    ],
    "notFound": ["..."]
  },
  "storyDigest": {
    "descriptionSummary": "...",
    "acceptanceCriteria": [ { "id": "AC1", "summary": "..." } ],
    "implementationHint": "...",
    "taskStepCounts": { "description": 0, "acceptanceCriteria": 0, "implementationHint": 0 }
  }
}
```

## ⚠️ QUY TẮC BẮT BUỘC
- File JSON phải là JSON hợp lệ (parseable), UTF-8, **100% nội dung viết bằng Tiếng Anh chuyên nghiệp** (giữ nguyên nhãn UI tiếng Đức thật nếu có, không dịch nhãn UI DE).
- KHÔNG kết luận Blocker/Warning trong file này — chỉ trích xuất sự kiện/dữ liệu thô đã cô đọng. Việc phân loại xung đột thuộc về `/analyze-story` chạy ở bước kế tiếp.
- KHÔNG sinh testcase/`.spec.ts` ở bước này.
- Nếu ticket không có ảnh/comment, vẫn phải ghi đủ cấu trúc JSON với mảng/giá trị rỗng tương ứng, không bỏ field.
