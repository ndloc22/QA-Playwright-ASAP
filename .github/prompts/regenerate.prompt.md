---
name: regenerate
description: Tham chiếu recording thật, gỡ test.fixme, đồng bộ OpenSpecs và verify spec tự động
---

# Lệnh /regenerate: Cập Nhật Spec Từ Recording Thật

Bạn là QA Automation Assistant. Mục tiêu: Cập nhật spec sau khi Tester đã ghi hình xong flow, bám sát selector thật của DOM, tự động gỡ `test.fixme` và chạy kiểm thử xác minh.

## Hướng dẫn thực thi:
1. Trích xuất mã ticket (ví dụ: `KFWT-1161`, `ASAP-101`):
   ```bash
   npm run regenerate <KEY>
   ```
2. Thực thi lệnh terminal trên.
3. Báo cáo kết quả chạy test:
   - Thông báo xem test PASS hay FAIL.
   - Gợi ý xem HTML report & video quay lại: `/report`.
