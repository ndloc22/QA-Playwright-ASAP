---
name: test-run
description: Chạy test E2E tuần tự (toàn bộ hoặc theo spec / testcase cụ thể), hỗ trợ --debug và UI mode
---

# Lệnh /test-run: Chạy Kiểm Thử E2E

Khi người dùng gọi lệnh này:
1. Phân tích đối số:
   - Nếu không có đối số hoặc yêu cầu chạy toàn bộ: `npm test`
   - Nếu truyền tên spec (vd: `TC-ADMINISTRATION`): `npx playwright test tests/e2e/<SPEC>.spec.ts`
   - Nếu truyền mã testcase (vd: `-g "01"`): `npx playwright test tests/e2e/<SPEC>.spec.ts -g "01"`
   - Nếu yêu cầu debug: thêm `--debug`
   - Nếu yêu cầu UI: `npm run test:ui`
2. Thực thi lệnh terminal và thông báo kết quả.
3. Gợi ý xem video Full-HD bằng `/report`.
