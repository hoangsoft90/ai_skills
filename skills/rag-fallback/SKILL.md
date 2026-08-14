---
name: rag-fallback
description: Fetch tài liệu/API mới nhất của Flutter, Riverpod, GoRouter hoặc package liên quan khi nghi ngờ lỗi build là do API đã deprecated hoặc skill/instruction cũ không còn khớp phiên bản hiện tại. CHỈ dùng khi mcp-loop đã thử sửa lỗi compile nhiều lần mà không được - KHÔNG fetch doc trước mỗi lần code như một bước mặc định (tốn token không cần thiết).
---

# RAG Fallback (có điều kiện)

## Điều kiện trigger (bắt buộc, không tùy tiện gọi)

Chỉ load skill này khi CẢ HAI điều sau đúng:
1. `mcp-loop` đã chạy tối thiểu 3-5 lần và vẫn còn lỗi compile cùng một chỗ.
2. Lỗi có dấu hiệu liên quan đến API/package đã đổi signature, bị deprecated, hoặc hàm không tồn tại như mô tả trong skill/agent-plugins hiện có (ví dụ: "method not found", "this constructor is deprecated", tên hàm đã đổi giữa các version).

Nếu lỗi là do logic của chính agent viết sai (không liên quan version) → không cần fallback, quay lại sửa trực tiếp trong `mcp-loop`.

## Quy trình

1. Xác định chính xác package/API đang gây lỗi (tên package + version hiện tại trong `pubspec.lock`).
2. Dùng `web_fetch`/`mcp_fetch` lấy tài liệu chính thức mới nhất của package đó (changelog, migration guide nếu có) - ưu tiên nguồn chính chủ (pub.dev, docs.flutter.dev, GitHub repo của package).
3. Tìm phần liên quan đến API đang lỗi, đối chiếu cú pháp mới.
4. Cập nhật code theo cú pháp mới, quay lại `mcp-loop` để build lại.
5. Nếu skill/agent-plugins hiện tại rõ ràng đã lỗi thời (không chỉ 1 API lẻ mà cả cách tiếp cận), ghi chú lại vào `openspec/config.yaml` (mục `context`) hoặc báo user để cân nhắc cập nhật lại skill gốc - không tự động sửa file skill của Google.

## Giới hạn số lần thử

Tối đa 2 lần fetch + sửa theo hướng RAG fallback. Nếu vẫn lỗi sau đó → dừng hẳn theo quy định trong `mcp-loop/SKILL.md` (xuất log, báo user), không tiếp tục fetch thêm nhiều nguồn khác nhau gây tốn token.

## Ghi chú chi phí

- Route lệnh fetch qua model/kênh rẻ nhất đủ dùng (nếu có 9Router hoặc tương đương), không cần dùng model mạnh nhất chỉ để đọc changelog.
- Không fetch "phòng hờ" trước khi biết chắc có lỗi - đây là fallback, không phải bước mặc định của `flutter-coding`.
