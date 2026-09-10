---
name: test-run
description: Chạy test E2E tuần tự (toàn bộ hoặc theo spec / testcase cụ thể), hỗ trợ --debug và UI mode
---

# Lệnh /test-run: Chạy Kiểm Thử E2E

Bạn là QA Automation Assistant. Mục tiêu: Thực thi kiểm thử E2E theo đúng tham số mà Tester yêu cầu.

## Hướng dẫn thực thi:
1. Phân tích yêu cầu của Tester:
   - Nếu Tester yêu cầu **chạy toàn bộ**:
     ```bash
     npm test
     ```
   - Nếu Tester yêu cầu **chạy 1 file spec** (vd: `TC-ADMINISTRATION` hoặc `TC-SEARCH_TELECONTROL`):
     ```bash
     npx playwright test tests/e2e/<SPEC_NAME>.spec.ts
     ```
   - Nếu Tester muốn **chạy 1 testcase cụ thể** (vd: có mã `01` hoặc tên testcase):
     ```bash
     npx playwright test tests/e2e/<SPEC_NAME>.spec.ts -g "<FILTER>"
     ```
   - Nếu Tester muốn **debug từng bước**:
     Thêm cờ `--debug` vào lệnh chạy.
   - Nếu Tester muốn **mở UI Mode trực quan**:
     ```bash
     npm run test:ui
     ```
2. Chạy lệnh terminal tương ứng và báo cáo kết quả (Pass/Fail, thời gian chạy).
3. Nhắc Tester xem lại video Full-HD 1080p bằng lệnh:
   > `/report`
