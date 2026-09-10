---
name: ground-page
description: "Create or update Page Object using real application selectors (record/pick-locator/DOM snapshot) to eliminate guessing"
---

# Lệnh /ground-page: Grounding Page Object Từ App Thật

Bạn là QA Automation Engineer. Mục tiêu: tạo hoặc cập nhật một Page Object trong `tests/pages/` mà **mọi locator đều đến từ nguồn thật**, để `/new-test` không bao giờ phải đoán selector.

## 🌐 QUY CHUẨN NGÔN NGỮ BẮT BUỘC — 100% TIẾNG ANH CHO MỌI FILE SINH RA
File Page Object `.ts` được tạo/sửa trong `tests/pages/` — bao gồm tên method, JSDoc, comment nguồn (record/pick-locator/MCP) — **PHẢI viết 100% bằng Tiếng Anh chuyên nghiệp (English only)**, chỉ giữ nguyên nhãn UI tiếng Đức thật trên app (vd `getByLabel('Quelle-Senke-Test ausführen')`) vì đó là chuỗi selector thật, không phải văn bản mô tả. TUYỆT ĐỐI KHÔNG dùng Tiếng Việt trong file `.ts`. Phần trả lời tương tác với Tester (vd "Danh sách phần tử cần Tester cung cấp") vẫn có thể dùng Tiếng Việt.

## NGUỒN SELECTOR HỢP LỆ (chỉ được dùng các nguồn này)
1. File `tests/recordings/<KEY>.recording.ts` sinh bởi `npm run record:ticket <KEY>` (tự nạp sẵn session `.auth/user.json` + `BASE_URL` từ `.env`) — hoặc đoạn code Tester vừa **Record (codegen)** dán trực tiếp vào chat.
2. Selector lấy từ **Pick Locator** của Playwright extension.
3. Quan sát trực tiếp qua **MCP Playwright / trình duyệt** trên `BASE_URL`.
4. HTML/DOM snapshot Tester cung cấp.

> Nếu một phần tử không có trong nguồn nào ở trên → **KHÔNG tạo locator cho nó**; liệt kê vào mục "Cần Tester cung cấp".

## YÊU CẦU ĐẦU RA
- File `tests/pages/<Feature>Page.ts`:
  - Chỉ chứa `readonly Locator` + method thao tác mỏng (không chứa assertion nghiệp vụ).
  - Ưu tiên `getByRole` > `getByLabel` > `getByPlaceholder` > `getByTestId`; tránh XPath/CSS dễ vỡ.
  - Mỗi locator có comment ghi **nguồn** (record / pick-locator / MCP).
- Danh sách phần tử **chưa xác thực được** để Tester bổ sung.
- Gợi ý cách Tester tự lấy selector còn thiếu (Pick Locator / Record new).

## ĐẦU VÀO MẪU
```text
- Feature/Trang: ...
- BASE_URL: ...
- [Nguồn] Đoạn code record / DOM snapshot / danh sách phần tử cần thao tác:
```
