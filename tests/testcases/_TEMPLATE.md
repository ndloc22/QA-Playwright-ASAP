# Testcase: TC-XXX-00 - <Tiêu đề ngắn gọn>

> Mẫu testcase giàu ngữ cảnh giúp AI KHÔNG phải đoán. Càng nhiều gợi ý UI/dữ liệu thật,
> test sinh ra càng bám thực tế và càng dễ "xanh ngay lần đầu".

- **Mã Testcase:** `TC-XXX-00`
- **Module:** <tên module/feature>
- **Mức độ:** High | Medium | Low
- **Liên kết yêu cầu:** <link Jira / User Story / mã requirement>
- **Precondition:** <trạng thái cần có trước khi chạy; nêu rõ dữ liệu và cách tạo>

## Các Bước Thực Hiện (Given / When / Then)
1. **Given:** <bối cảnh ban đầu>
2. **When:** <thao tác người dùng — nêu rõ tên nút/nhãn field như hiển thị trên UI>
3. **Then (Expected Result):**
   - <kỳ vọng 1 — mô tả CHÍNH XÁC điều nhìn thấy trên UI>
   - <kỳ vọng 2>

## 🔎 Gợi Ý UI Thật (giúp AI grounding — điền nếu biết)
| Phần tử | Cách nhận biết trên UI | Gợi ý locator |
|---|---|---|
| Ô nhập ... | placeholder/nhãn "..." | `getByPlaceholder('...')` |
| Nút ... | text nút "..." | `getByRole('button', { name: '...' })` |
| Kết quả ... | text/vùng hiển thị "..." | `getByText('...')` / `getByTestId('...')` |

## 🧪 Test Data
- Đầu vào: <giá trị cụ thể sẽ nhập>
- Kỳ vọng hiển thị: <giá trị chính xác dùng cho assertion>

## 🧩 Page Object liên quan (nếu đã có)
- `tests/pages/<Feature>Page.ts` — tái sử dụng, không tạo trùng.
