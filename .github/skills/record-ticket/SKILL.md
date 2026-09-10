---
name: record-ticket
description: Mở web thật và codegen để ghi hình flow của Ticket hoặc Function vào tests/recordings/
---

# Lệnh /record-ticket: Mở Trình Ghi Hình Flow (Codegen)

Khi người dùng gọi lệnh này (ví dụ: `/record-ticket KFWT-1161` hoặc `/record-ticket ADMINISTRATION`):
1. Trích xuất mã ticket hoặc tên function từ đối số người dùng nhập.
2. Kích hoạt lệnh terminal:
   ```bash
   npm run record:ticket <KEY_OR_FUNCTION>
   ```
3. Hướng dẫn Tester:
   - Cửa sổ trình duyệt đang mở ra kèm bộ công cụ Playwright Recorder.
   - Hãy thao tác các bước nghiệp vụ trên web.
   - Khi hoàn tất, chỉ cần đóng cửa sổ trình duyệt lại, file recording sẽ tự động lưu vào `tests/recordings/<KEY>.recording.ts`.
4. Gợi ý bước kế tiếp:
   - Nếu là Jira Ticket: chạy `/regenerate <KEY>`
   - Nếu là Function độc lập: chạy `/sync-specs <FUNCTION>`
