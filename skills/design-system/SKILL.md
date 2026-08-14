---
name: design-system
description: Quy định spacing, màu sắc, typography, elevation cố định cho toàn bộ app Flutter, để agent không tự "sáng tạo" giao diện mỗi lần. Dùng skill này bất cứ khi nào sinh hoặc sửa UI/widget, hoặc khi user mô tả cảm tính như "đẹp như Grab", "sang trọng hơn", "trẻ trung hơn".
---

# Design System

Mục tiêu: dịch các mô tả cảm tính của user ("đẹp như Grab", "tối giản hơn") thành giá trị cụ thể, cố định, để code sinh ra nhất quán qua nhiều lần chạy.

## Giá trị mặc định (đọc/ghi vào `openspec/config.yaml` mục `context`, phần "Design tokens" - nếu project chưa có thì thêm mới)

```yaml
colors:
  primary: "#..."      # brand color - lấy từ config.yaml nếu user đã cung cấp, nếu chưa dùng Material 3 seed mặc định
  surface: "#FFFFFF"
  error: "#B3261E"
spacing:
  xs: 4
  sm: 8
  md: 16
  lg: 24
  xl: 32
radius:
  sm: 8
  md: 12
  lg: 16
typography:
  base: Material 3 default (Roboto) trừ khi user chỉ định font khác
elevation:
  card: 1
  dialog: 3
```

## Quy tắc áp dụng

- Không dùng số magic (`padding: 13`, màu hex rời rạc trong widget) — luôn tham chiếu token ở trên qua `Theme.of(context)` hoặc file `app/theme/`.
- Khi user nói cảm tính, dịch sang thay đổi token cụ thể rồi ghi lại vào `openspec/config.yaml` (mục `context`), ví dụ:
  - "Đẹp như Grab" → tăng contrast, bo góc `radius.md` cho card, dùng màu primary đậm, spacing rộng rãi hơn (`md`/`lg`).
  - "Tối giản hơn" → giảm elevation, giảm số màu dùng trên 1 màn hình, tăng khoảng trắng.
- Mỗi lần đổi token, cập nhật vào `config.yaml` để lần sau agent tự đọc, không hỏi lại / không đoán lại từ đầu (config được inject tự động vào mọi artifact OpenSpec).

## Khi UI-checkpoint bị từ chối ("chưa đúng ý")

- Hỏi lại đúng 1 câu để xác định thay đổi cụ thể (ví dụ: "to chữ hơn hay đổi màu?"), KHÔNG hỏi nhiều câu cùng lúc.
- Map câu trả lời của user sang token cụ thể ở trên, sửa, rồi quay lại `mcp-loop` để build lại.

## Widget Library ưu tiên tái sử dụng

Trước khi tạo widget mới, kiểm tra `shared/widgets/` đã có chưa (Card, BottomSheet, OTP input, AddressPicker, ChatBubble, Timeline, Dashboard...). Ưu tiên tái sử dụng, chỉ tạo mới khi thực sự chưa có.
