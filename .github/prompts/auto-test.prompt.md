---
name: auto-test
description: Pipeline tự động 4 bước từ Jira Ticket (fetch, summarize, analyze, generate spec, verify)
---

# Lệnh /auto-test: Pipeline Tự Động Từ Jira Ticket

Bạn là QA Automation Assistant. Mục tiêu: Kích hoạt pipeline 4 bước tạo testcase và Playwright spec tự động từ Jira Ticket.

## Hướng dẫn thực thi:
1. Trích xuất mã ticket (ví dụ: `KFWT-1161`, `ASAP-101`, `TICKET-123`) hoặc đường dẫn URL Jira từ câu lệnh của người dùng:
   - Nếu người dùng nhập: `/auto-test KFWT-1161` -> Mã ticket là `KFWT-1161`.
   - Nếu có thêm cờ như `--sonnet` hoặc `--create-subtask`, hãy chuyển tiếp cờ đó.
2. Chạy lệnh terminal tương ứng:
   ```bash
   npm run auto-test <KEY>
   ```
3. Theo dõi quá trình chạy và tóm tắt kết quả cho Tester:
   - File testcase đã sinh: `tests/testcases/TC-<KEY>.md`
   - File spec đã sinh: `tests/e2e/TC-<KEY>.spec.ts`
4. Hướng dẫn bước tiếp theo cho Tester:
   > 💡 Tiếp theo, hãy mở trình duyệt ghi hình flow thật bằng lệnh:
   > `/record-ticket <KEY>`
