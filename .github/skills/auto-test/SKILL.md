---
name: auto-test
description: Pipeline tự động 4 bước từ Jira Ticket (fetch, summarize, analyze, generate spec, verify)
---

# Lệnh /auto-test: Pipeline Tự Động Từ Jira Ticket

Khi người dùng gọi lệnh này (ví dụ: `/auto-test KFWT-1161` hoặc `/auto-test ASAP-101`):
1. Trích xuất mã ticket hoặc URL Jira từ đối số người dùng nhập.
2. Chạy lệnh terminal tương ứng trong thư mục dự án:
   ```bash
   npm run auto-test <KEY>
   ```
   (Nếu người dùng truyền thêm cờ như `--sonnet` hay `--create-subtask`, hãy chuyển tiếp cờ đó).
3. Báo cáo kết quả:
   - File testcase đã sinh: `tests/testcases/TC-<KEY>.md`
   - File spec đã sinh: `tests/e2e/TC-<KEY>.spec.ts`
4. Gợi ý bước tiếp theo: Mở web thật để ghi hình flow bằng lệnh `/record-ticket <KEY>`.
