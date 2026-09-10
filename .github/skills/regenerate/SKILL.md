---
name: regenerate
description: Tham chiếu recording thật, gỡ test.fixme, đồng bộ OpenSpecs và verify spec tự động
---

# Lệnh /regenerate: Cập Nhật Spec Từ Recording Thật

Khi người dùng gọi lệnh này (ví dụ: `/regenerate KFWT-1161` hoặc `/regenerate SEARCH_TELECONTROL`):
1. Trích xuất mã ticket hoặc tên function từ đối số người dùng nhập.
2. Kích hoạt lệnh terminal:
   ```bash
   npm run regenerate <KEY_OR_FUNCTION>
   ```
3. Báo cáo kết quả kiểm thử (Pass/Fail) và nhắc Tester mở xem video nếu cần bằng lệnh `/report`.
