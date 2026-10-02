---
description: 'Test menu — Kiểm thử tất cả link dưới menu Start / Governance / Administration của widget "My processes" trên Cyber Security Portal. Nhận input môi trường (DEV/QA1/QA2), mở lần lượt từng link NGAY TRÊN TAB HIỆN TẠI (không mở tab mới), rồi báo cáo số link truy cập được và link lỗi.'
tools: ['open_browser_page', 'navigate_page', 'read_page', 'click_element', 'run_playwright_code', 'handle_dialog', 'vscode_askQuestions']
---

# Test menu

Kiểm thử toàn bộ link dưới 3 menu `Start`, `Governance`, `Administration` của widget **My processes** trên Cyber Security Portal.

## Môi trường

| Env | Base URL |
|-----|----------|
| DEV | `https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec` |
| QA1 | `https://bpm-qa.eon.com/cybersec12/EON_LDAP/CyberSec` |
| QA2 | `https://bpm-qa.eon.com/cybersec12v2/ITSP/ITSP` |

## Quy tắc bắt buộc

- **Chỉ dùng MỘT tab duy nhất.** Luôn điều hướng trên tab đang được share/active. **Không** gọi `open_browser_page` với `forceNew`, **không** tạo page mới bằng `context.newPage()`.
  - Lý do: page mới không kế thừa session đăng nhập → bị redirect sang `login.microsoftonline.com` và cho kết quả sai.
- Không thực hiện thao tác ghi dữ liệu (submit, save, delete) trong quá trình test. Chỉ mở link và kiểm tra render.

## Quy trình

### 1. Input môi trường
Hỏi người dùng chọn `DEV` / `QA1` / `QA2` (dùng `vscode_askQuestions`). Nếu người dùng đã nêu rõ môi trường thì bỏ qua bước hỏi.

### 2. Mở Portal Home trên tab hiện tại
Điều hướng tab hiện tại tới `<baseUrl>/pro/portal/1549F58C18A6C562/DefaultApplicationHomePage.ivp`.

### 3. Thu thập danh sách link từ menu
Menu nằm trong iframe `CustomMenuWidget.xhtml` của widget "My processes". Submenu đã có sẵn trong DOM (không cần hover/click). Trích xuất bằng `run_playwright_code`:

```js
const f = page.frames().find(fr => fr.url().includes('CustomMenuWidget'));
const data = await f.evaluate(() => Array.from(document.querySelectorAll('[role=menubar] > li')).map(li => ({
  menu: (li.querySelector('a,span') || li).innerText.trim(),
  items: Array.from(li.querySelectorAll('ul li a'))
    .map(a => ({ name: a.innerText.trim(), href: a.getAttribute('href') }))
    .filter(x => x.href && x.href !== '#')
})));
return JSON.stringify(data);
```

Bỏ qua các mục có `href === '#'` (chỉ là nhóm/label, không phải link).

### 4. Mở lần lượt từng link trên chính tab đó
Duyệt tuần tự, mỗi vòng lặp:

```js
page.on('dialog', d => d.accept().catch(() => {}));           // auto-accept beforeunload
for (const f of page.frames()) {                               // gỡ beforeunload trước khi rời trang
  try { await f.evaluate(() => { window.onbeforeunload = null; }); } catch (e) {}
}
const r = await page.goto(baseHost + href, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(2500);
// ghi nhận: r.status(), page.url(), nội dung text của các child frame
```

Ghi nhận cho mỗi link: HTTP status, URL cuối cùng, đoạn text đầu của iframe nội dung, và exception nếu có.

Chia thành các batch nhỏ (3–4 link) để tránh timeout và tránh mất kết quả khi bị dialog chặn.

### 5. Tiêu chí PASS / FAIL

PASS khi thoả cả 3:
- HTTP status `200`
- URL cuối **không** redirect sang `login.microsoftonline.com`
- iframe nội dung render đúng trang nghiệp vụ (có text/bảng/form), không chứa `404`, `Not Found`, `Error`, `Session expired`

Ngược lại → FAIL, ghi rõ lý do.

### 6. Đóng test run
Điều hướng tab hiện tại quay lại Portal Home.

## Xử lý sự cố

| Vấn đề | Cách xử lý |
|--------|-----------|
| `Action was interrupted by a dialog` | Gọi lại `run_playwright_code` với `deferredResultId` đã trả về, cùng `pageId`. Đăng ký `page.on('dialog', d => d.accept())` ngay đầu script. |
| `Cannot perform action while a dialog is open` | Dùng `handle_dialog` với `acceptModal: true`, sau đó chạy lại batch. |
| Bị redirect sang trang đăng nhập Microsoft | Đang dùng tab/page mới — quay lại dùng đúng tab hiện tại. |
| `read_page` trả snapshot quá lớn | Ưu tiên `run_playwright_code` + `evaluate` để lấy dữ liệu gọn thay vì đọc cả snapshot. |

## Định dạng báo cáo

```markdown
# Test run: "Test menu" — <ENV>
Môi trường: <baseUrl>
Phạm vi: widget My processes → Start / Governance / Administration

## Tổng quan
| Menu | Số link | Access OK | Lỗi |
|---|---|---|---|
| Start | n | n | n |
| Governance | n | n | n |
| Administration | n | n | n |
| **Tổng** | n | n | n |

## Chi tiết
<Liệt kê từng link theo menu: tên — OK / FAIL (kèm status + lý do)>

## Kết luận
<Danh sách link lỗi, hoặc xác nhận không có link lỗi>
```
