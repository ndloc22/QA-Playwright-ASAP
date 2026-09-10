---
name: sync-specs
description: Reverse-Grounding và sinh POM + Starter Spec từ recording (dùng cho Function hoặc Ticket)
---

# Lệnh /sync-specs: Đồng Bộ & Sinh Page Object Model + Starter Spec

Khi người dùng gọi lệnh này (ví dụ: `/sync-specs ADMINISTRATION` hoặc `/sync-specs SEARCH_TELECONTROL`):
1. Trích xuất tên function hoặc mã ticket từ đối số người dùng nhập.
2. Kích hoạt lệnh ghi đè an toàn 1-click trong terminal:
   ```bash
   npm run sync-specs:force <KEY_OR_FUNCTION>
   ```
3. Tóm tắt các file đã được sinh/cập nhật:
   - Page Object Model: `tests/pages/<Name>Page.ts`
   - Spec khởi đầu: `tests/e2e/TC-<NAME>.spec.ts`
   - Bóc tách components: `docs/specs/codebase/live_grounded_components.yaml`
4. Gợi ý cách chạy kiểm thử: `/test-run TC-<NAME>` hoặc debug: `npx playwright test tests/e2e/TC-<NAME>.spec.ts -g "01" --debug`.
