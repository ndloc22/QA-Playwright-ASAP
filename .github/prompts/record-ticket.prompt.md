---
name: record-ticket
description: Mở web thật và codegen để ghi hình flow của Ticket hoặc Function vào tests/recordings/
---

# Lệnh /record-ticket: Mở Trình Ghi Hình Flow (Codegen)

Bạn là QA Automation Assistant. Mục tiêu: Khởi động trình duyệt Playwright Codegen đã nạp sẵn session đăng nhập (`.auth/user.json`) và `BASE_URL` từ `.env` để Tester thao tác flow trên web thật.

## Hướng dẫn thực thi:
1. Trích xuất mã ticket hoặc tên function từ người dùng (ví dụ: `KFWT-1161`, `ADMINISTRATION`, `SEARCH_TELECONTROL`):
   ```bash
   npm run record:ticket <KEY_OR_FUNCTION>
   ```
2. Chạy lệnh trên terminal.
3. Nhắc nhở Tester:
   - Cửa sổ trình duyệt đang mở ra kèm bộ công cụ Playwright Recorder.
   - Hãy thực hiện đúng các thao tác nghiệp vụ trên web.
   - Sau khi hoàn thành, **chỉ cần đóng cửa sổ trình duyệt lại**, kết quả sẽ tự động lưu vào `tests/recordings/<KEY>.recording.ts`.
4. Sau khi ghi hình xong, gợi ý lệnh tiếp theo:
   - Nếu là Jira Ticket: `/regenerate <KEY>`
   - Nếu là Function độc lập: `/sync-specs <FUNCTION>`
