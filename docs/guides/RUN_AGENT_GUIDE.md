# 🤖 Hướng Dẫn Sử Dụng AI Agent Runner

## Mục đích
Script `scripts/run-agent.js` cho phép chạy test case **tự động hoàn toàn** bằng AI Agent (GitHub Copilot CLI hoặc Claude CLI) dựa trên kịch bản recording có sẵn.

## Yêu cầu
- ✅ Đã cài đặt GitHub Copilot CLI HOẶC Claude CLI
- ✅ File recording tồn tại: `tests/recordings/functions/<MODULE>.recording.ts`
- ✅ File POM được compile (tùy chọn, tăng độ ổn định): `tests/pages/functions/<MODULE>Page.ts`

## Cách sử dụng

### 1. Chạy với CLI mặc định (Claude)
```bash
npm run test:agent CREATE_RISK_REQUEST
```

### 2. Chọn CLI cụ thể
```bash
# Sử dụng Claude CLI
npm run test:agent CREATE_RISK_REQUEST -- --cli claude

# Sử dụng GitHub Copilot CLI
npm run test:agent CREATE_RISK_REQUEST -- --cli copilot
```

### 3. Điều chỉnh tốc độ (SlowMo)
```bash
# Chạy chậm hơn (1000ms delay mỗi action) để quan sát
npm run test:agent CREATE_RISK_REQUEST -- --slowmo 1000

# Chạy nhanh hơn (200ms delay)
npm run test:agent CREATE_RISK_REQUEST -- --slowmo 200
```

### 4. Chế độ Heal / Auto-fill (mặc định TẮT — tôn trọng Ground Truth)
```bash
# Mặc định: agent TÔN TRỌNG kịch bản. KHÔNG tự điền field còn rỗng /
# dropdown chưa chọn (Tester có thể chủ đích để trống: negative / optional test).
# Nếu validation chặn luồng → agent DỪNG và báo cáo trung thực các field còn thiếu.
npm run test:agent CREATE_RISK_REQUEST

# Bật heal: cho phép agent tự động điền/chọn field còn thiếu để cứu luồng.
npm run test:agent CREATE_RISK_REQUEST -- --heal
# (đồng nghĩa: --auto-fill, hoặc đặt biến môi trường AI_AGENT_HEAL=true)
```

> ⚖️ **Chính sách Ground Truth:** Việc agent tự ý điền ngầm vào mọi field rỗng
> làm sai lệch bản chất ca kiểm thử. Vì vậy hành vi mặc định là **không tự điền**;
> agent chỉ liệt kê (báo cáo) các blocker và để luồng chạy đúng như kịch bản.
> Chỉ khi bật cờ `--heal` / `--auto-fill` agent mới được phép tự điền/chọn.
> Ở chế độ mặc định, ngay cả AI Rescue cũng bị **cấm** thực thi hành động `fill`.

## Luồng hoạt động

```
1. Load POM (nếu có) ────────┐
                              │
2. Launch Chromium (headed) ──┤
                              │
3. Mở Portal & xử lý SSO ─────┤
                              │
4. Click "Start Process" ─────┤
                              │
5. Điền form Application ─────┤  ← Sử dụng pattern từ POM
                              │     100% đã kiểm chứng
6. Điền Likelihood (5 Q) ─────┤
                              │
7. Điền Risk Treatment ───────┤
                              │
8. Hoàn tất & giữ browser ────┘
   mở 8s để quan sát
```

## Xử lý lỗi thường gặp

### ❌ Lỗi: "Không tìm thấy CLI"
```bash
# Cài đặt GitHub Copilot CLI
npm install -g @githubnext/github-copilot-cli

# HOẶC cài đặt Claude CLI (follow hướng dẫn từ Anthropic)
```

### ❌ Lỗi: "Timeout 30000ms exceeded"
**Nguyên nhân**: Mạng chậm hoặc server phản hồi chậm
**Giải pháp**: 
- Tăng slowmo: `--slowmo 1000`
- Kiểm tra kết nối mạng
- Chạy lại lần 2 (session đã authenticated sẽ nhanh hơn)

### ❌ Lỗi: "SSO Hand-off timeout"
**Nguyên nhân**: Chưa đăng nhập MFA trong 120s
**Giải pháp**: 
- Chuẩn bị tài khoản trước
- Đăng nhập ngay khi popup hiện ra
- Lưu auth: File `.auth/user.json` sẽ tự lưu để lần sau không cần đăng nhập lại

### ❌ Lỗi: "POM not found"
**Không phải lỗi!** Script sẽ tự động fallback sang pattern đã kiểm chứng.

Nếu muốn dùng POM để tăng tốc độ:
```bash
# Compile POM trước
npx tsc tests/pages/functions/CreateRiskRequestPage.ts --outDir dist --module commonjs
```

## Tính năng tự động

### ✅ Auto Fallback
Nếu CLI đầu tiên fail (quota hết, mạng lỗi), script tự động chuyển sang CLI còn lại:
```
Claude fail → Tự động thử Copilot
Copilot fail → Tự động thử Claude
```

### ✅ SSO Hand-off
Khi gặp trang đăng nhập Microsoft Azure AD:
- Script tự động **dừng** và chờ Tester đăng nhập thủ công
- Timeout: 120 giây
- Sau khi đăng nhập xong, script tự động lưu session vào `.auth/user.json`
- Lần sau chạy sẽ **không cần đăng nhập lại**

### ✅ POM Auto-Compile
Nếu có file `.ts` nhưng chưa compile:
- Script tự động compile on-the-fly
- Lưu vào `dist/pages/functions/`
- Load và sử dụng ngay

### ✅ Dialog Auto-Accept
Mọi browser dialog (alert, confirm, beforeunload) đều được **tự động accept** để không làm gián đoạn flow.

## Logs

Mỗi lần chạy sẽ tạo log file:
```
logs/agent-runs/agent-CREATE_RISK_REQUEST-2026-09-25T08-54-54-311Z.log
```

Log chứa:
- CLI output
- AI reasoning (nếu có)
- Error stack trace (nếu có)

## So sánh với Mode 1 (Native Runner)

| Feature | Mode 1 (npm run test:function) | Mode 2 (npm run test:agent) |
|---------|--------------------------------|----------------------------|
| **Cần AI CLI** | ❌ Không | ✅ Có (Copilot/Claude) |
| **Token cost** | 🆓 0 token | 💰 ~5k-20k tokens/run |
| **Tốc độ** | ⚡ Nhanh (~2-3 phút) | 🐢 Chậm hơn (~5-8 phút) |
| **Độ ổn định** | 💯 100% | 🎯 95-98% (tùy network) |
| **Use case** | CI/CD, regression test | Demo, exploratory, debugging |
| **Browser** | Headless (có thể headed) | Headed (quan sát được) |

## Khi nào dùng Mode 2?

✅ **Nên dùng khi:**
- Demo cho khách hàng / stakeholder (quan sát trực quan)
- Debug issue phức tạp (xem AI tương tác như thế nào)
- Exploratory testing (chưa có POM ổn định)
- Training/onboarding tester mới

❌ **Không nên dùng khi:**
- Chạy CI/CD pipeline (dùng Mode 1)
- Chạy regression suite hàng ngày (dùng Mode 1)
- Cần tốc độ nhanh nhất (dùng Mode 1)
- Không có network/quota AI CLI

## Best Practices

1. **Luôn compile POM trước** để tăng độ ổn định:
   ```bash
   npm run build
   ```

2. **Chạy với slowmo=500-800** để quan sát rõ:
   ```bash
   npm run test:agent CREATE_RISK_REQUEST -- --slowmo 800
   ```

3. **Lưu auth session** để tiết kiệm thời gian:
   - File `.auth/user.json` không commit vào git
   - Chạy lần đầu để tạo session
   - Lần sau tự động reuse

4. **Check logs** khi có lỗi:
   ```bash
   cat logs/agent-runs/agent-CREATE_RISK_REQUEST-*.log
   ```

---

**Maintained by**: QA Team  
**Last updated**: 2026-09-25  
**Related**: [FIX_SUMMARY.md](./FIX_SUMMARY.md)
