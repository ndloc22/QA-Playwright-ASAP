---
name: sync-specs
description: Reverse-Grounding và sinh POM + Starter Spec từ recording (dùng cho Function hoặc Ticket)
---

# Lệnh /sync-specs: Đồng Bộ & Sinh Page Object Model + Starter Spec

Bạn là QA Automation Assistant. Mục tiêu: Bóc tách component sống từ recording, cập nhật OpenSpecs (Reverse-Grounding) và tạo Page Object Model (`tests/pages/<Name>Page.ts`) cùng Starter Spec (`tests/e2e/TC-<NAME>.spec.ts`).

## Hướng dẫn thực thi:
1. Trích xuất tên function hoặc mã ticket từ người dùng (ví dụ: `ADMINISTRATION`, `SEARCH_TELECONTROL`, `KFWT-1161`):
   - Mặc định sử dụng chế độ ghi đè an toàn 1-click:
   ```bash
   npm run sync-specs:force <KEY_OR_FUNCTION>
   ```
2. Thực thi lệnh terminal trên.
3. Tóm tắt các file đã được tạo / cập nhật:
   - Page Object Model: `tests/pages/<Name>Page.ts`
   - Spec khởi đầu: `tests/e2e/TC-<NAME>.spec.ts`
   - Tri thức sống: `docs/specs/codebase/live_grounded_components.yaml`
4. Hướng dẫn Tester cách chạy kiểm thử function vừa sinh:
   > `/test-run TC-<NAME>` hoặc chạy 1 testcase lẻ: `npx playwright test tests/e2e/TC-<NAME>.spec.ts -g "01"`
