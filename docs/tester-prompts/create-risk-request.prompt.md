---
mode: 'agent'
description: 'Tạo một Risk Assessment cơ bản trên Cyber Security Portal môi trường DEV theo quy trình đã ghi lại'
---

# Tạo Risk Assessment cơ bản

Khi người dùng gọi `/create-risk-request`, thực hiện trực tiếp trên trình duyệt hiện tại, không chỉ mô tả hướng dẫn.

## Môi trường và quy tắc

- Luôn dùng môi trường DEV: `https://bpm-qa.eon.com/dev_cybersec12/EON_LDAP/CyberSec`.
- Bắt buộc thao tác trên tab hiện tại; không mở tab mới cho các màn hình của Portal.
- Giữ phiên SSO hiện tại. Nếu gặp trang đăng nhập, yêu cầu người dùng đăng nhập thủ công, không hỏi hoặc xử lý mật khẩu.
- Các màn hình nghiệp vụ nằm trong iframe. Tìm frame có URL chứa `de.eon.itsp.riskassessment` và thao tác trong frame đó.
- Trang task có thể đăng ký `beforeunload`; trước khi điều hướng trong cùng tab, tự động chấp nhận dialog và vô hiệu hóa handler trên các frame nếu cần.
- Không tạo file test hoặc sửa mã nguồn ứng dụng trừ khi người dùng yêu cầu.
- Nếu một control PrimeFaces/custom bị ẩn, dùng locator theo label/giá trị ổn định hoặc dispatch sự kiện trên control tương ứng; không mở tab mới.

## Quy trình

1. Mở Processes từ menu Portal.
2. Tìm process `Risk Assessment Create new Workflow` và bấm `Start process` thuộc đúng card.
3. Ở Risk Description:
   - Risk Type: `Cyber Risk`.
   - Asset Type: `Application`.
   - Chọn application `APL207478 - Application Portal`.
4. Tạo risk cơ bản:
   - Risk Title: `data test`.
   - Risk Description: `data test`.
   - Risk Consequence: `data test`.
   - Risk Target: chọn `Confidentiality`.
   - Potential Impact: mức `2` (Medium).
   - Chọn các giá trị đánh giá mặc định sau:
     - `Network and programming skills`.
     - `Difficult`.
     - `Special access or resources required`.
     - `Hidden`.
     - `Intranet user`.
     - `Logged and reviewed`.
     - `A little`.
   - Nếu có trường `What existing measures are reduced?`, nhập `data test`.
5. Bấm `Next` để chuyển sang Risk Treatment.
6. Chọn `2` Risk Category Tag.
7. Chọn `1` control trong `E.ON Policy Framework` để trường bắt buộc không còn cảnh báo. Nếu danh sách control hiển thị, ưu tiên chọn control đầu tiên khả dụng; không chọn Local Security Standards nếu người dùng không yêu cầu.
8. Bấm `Next` và xác nhận Risk Overview hiển thị risk vừa tạo với target `Confidentiality`, trạng thái `Active`, và score được tính.
9. Báo cáo mã request `RA...`, Risk ID `CS-...`, các giá trị đã nhập và trạng thái hoàn tất. Nếu ứng dụng báo lỗi hoặc thiếu control, dừng tại bước đó và báo lỗi chính xác.

## Ghi nhận

- Quy trình mẫu đã tạo thành công `RA11348`, risk `CS-52005`, Untreated Risk score `10.0`.
- Không hard-code mã RA/Risk ID khi chạy lại; đây là mã sinh mới của mỗi lần tạo.
