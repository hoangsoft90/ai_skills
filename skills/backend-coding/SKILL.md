---
name: backend-coding
description: Thiết kế schema Postgres, viết Row Level Security (RLS) policy, và Edge Function (Deno/TypeScript) cho Supabase khi tính năng cần logic phía server (không thể/không nên để client tự làm - ví dụ tính giá, webhook thanh toán, phân quyền dữ liệu). Dùng skill này song song với flutter-coding khi 1 task trong tasks.md cần cả phần client (Flutter) lẫn phần server (Supabase).
---

# Backend Coding (Supabase)

## Khi nào cần skill này (không phải mọi task)

Chỉ trigger khi task thực sự cần logic phía server, KHÔNG trigger cho task chỉ là CRUD đơn giản (Supabase client SDK trong Flutter tự query/insert/update trực tiếp là đủ, không cần viết gì thêm ở đây):

- Phân quyền dữ liệu phức tạp hơn "user chỉ xem của mình" đơn giản → viết RLS policy.
- Tính toán không thể tin client (giá, tổng tiền, áp dụng voucher, số dư ví) → Edge Function hoặc Postgres function, không tính ở Flutter rồi gửi kết quả lên.
- Webhook từ bên thứ 3 (Momo callback, xác nhận thanh toán) → Edge Function nhận request, xác thực chữ ký, cập nhật DB.
- Job chạy định kỳ (nhắc lịch hẹn, dọn dữ liệu cũ) → Supabase Cron + Edge Function.
- Validate business rule mà RLS đơn thuần không diễn đạt được (ví dụ: không cho đặt lịch trùng giờ) → Postgres function/trigger hoặc Edge Function.

## Thiết kế Schema (Postgres)

1. Đọc delta spec (`openspec/changes/<change-name>/specs/`) để lấy Data Model - đây là nguồn field/bảng, không tự bịa thêm cột ngoài spec.
2. Map 1-1 sang bảng Postgres, dùng đúng kiểu dữ liệu (`text`, `numeric` cho tiền - KHÔNG dùng `float` cho tiền, `timestamptz` cho thời gian, `uuid` cho khóa chính mặc định).
3. Khai báo foreign key rõ ràng cho quan hệ 1-nhiều/nhiều-nhiều thay vì nhúng mảng JSON tùy tiện - tận dụng đúng thế mạnh quan hệ của Postgres so với NoSQL.
4. Nếu delta spec đánh dấu "BREAKING" (đổi field bảng đã có dữ liệu) → chuyển qua `schema-migration/SKILL.md` trước, viết migration SQL (`ALTER TABLE`) thay vì DROP+CREATE lại.

## Row Level Security (RLS)

- Mặc định BẬT RLS cho mọi bảng chứa dữ liệu người dùng (không bao giờ để bảng public không có policy).
- Viết policy tối thiểu cần thiết cho từng thao tác (`select`, `insert`, `update`, `delete`) riêng biệt, không gộp 1 policy "cho phép hết" rồi lọc ở client.
- Ví dụ pattern phổ biến:
  ```sql
  create policy "user xem don hang cua minh"
    on orders for select
    using (auth.uid() = user_id);

  create policy "chi admin sua trang thai don hang"
    on orders for update
    using (exists (select 1 from staff where staff.user_id = auth.uid() and staff.role = 'admin'));
  ```
- Test policy qua MCP/Supabase local trước khi coi task là xong - không chỉ tin code đọc đúng, phải chạy thử với user thật khác quyền.

## Edge Function (khi cần logic server thật)

1. Viết bằng Deno/TypeScript, đặt trong `supabase/functions/<ten-function>/index.ts`.
2. Với mọi tính toán tiền/số lượng: tính toán 100% ở Edge Function/Postgres function, Flutter chỉ hiển thị kết quả trả về, KHÔNG tự tính rồi gửi lên để server "xác nhận lại" - phải là server tính từ đầu.
3. Webhook (Momo, v.v.): luôn xác thực chữ ký/signature từ bên thứ 3 trước khi xử lý, không tin request chỉ vì đúng URL.
4. Trả lỗi rõ ràng (HTTP status + message) để `flutter-coding` phía client xử lý đúng, không trả lỗi chung chung.

## Sau khi viết xong backend

- Chuyển sang `flutter-coding/SKILL.md` để viết phần client gọi đúng RPC/Edge Function/table vừa tạo (dùng `supabase_flutter` package).
- Chạy `mcp-loop/SKILL.md` để test toàn bộ luồng end-to-end (client gọi thật, không chỉ test riêng backend).

## Package Supabase phía Flutter (thêm vào danh sách đã duyệt trong `architecture/SKILL.md` nếu chưa có)

- `supabase_flutter` - client chính thức, dùng cho Auth + Realtime + Postgrest query trực tiếp cho CRUD đơn giản.
- Không tự thêm package Supabase cộng đồng khác ngoài package chính thức trừ khi user xác nhận.
