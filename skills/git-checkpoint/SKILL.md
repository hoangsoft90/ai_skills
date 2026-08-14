---
name: git-checkpoint
description: Tạo branch riêng cho mỗi opsx change (không code thẳng trên main), tự động commit sau khi user xác nhận UI ổn (qua ui-checkpoint), merge vào main khi change đã archive xong, và xử lý yêu cầu "quay lại", "undo", "bỏ tính năng vừa thêm" bằng git thay vì đọc lại code để xóa thủ công - tiết kiệm token đáng kể. Dùng skill này ngay khi 1 change mới được tạo (để branch), sau ui-checkpoint (để commit), sau archive (để merge), hoặc bất cứ khi nào user muốn hủy/quay lại thay đổi gần đây.
---

# Git Checkpoint (Bộ nhớ Undo không tốn token)

## Branch theo từng change (làm TRƯỚC khi bắt đầu code, ngay khi có change từ `/opsx:new`/`/opsx:propose`)

Không code thẳng trên `main`. Ngay khi 1 change được tạo (sau `/opsx:new` hoặc `/opsx:propose`, trước khi vào `flutter-coding`):

1. Kiểm tra đang ở branch nào: `git branch --show-current`.
2. Nếu đang ở `main` (hoặc branch chính khác) → tạo branch mới đặt tên theo change: `git checkout -b change/<change-name>` (lấy `<change-name>` đúng từ tên thư mục `openspec/changes/<change-name>/`).
3. Nếu đã đang ở đúng branch `change/<change-name>` từ trước (ví dụ resume qua `/opsx:continue` ở session mới) → không tạo lại, dùng luôn.
4. Toàn bộ commit theo task (mục dưới) đều nằm trên branch này, KHÔNG merge vào `main` cho đến khi `/opsx:archive` chạy xong.

**Khi hoàn tất change** (sau bước "Hoàn tất change" bên dưới, đã archive xong):
```bash
git checkout main
git merge change/<change-name>
git branch -d change/<change-name>
```
Chỉ merge khi `/opsx:verify` đã pass và `/opsx:archive` đã chạy xong - không merge nửa chừng.

**Nếu đang làm dở 1 change mà cần dừng để việc khác gấp:** không cần làm gì thêm, `main` vẫn sạch vì code đang nằm trên branch riêng. Quay lại sau bằng `git checkout change/<change-name>` + `/opsx:continue`.

## Commit theo từng task, và hoàn tất change khi xong hết (luồng bình thường)

**Commit từng task** (trong lúc `/opsx:apply` đang chạy, sau mỗi task pass `mcp-loop` + `ui-checkpoint` nếu có UI):

1. `git add -A`
2. Commit message ngắn theo task vừa xong, ví dụ `feat(order): thêm màn hình đặt hàng trà sữa`.
3. Không commit khi task đó vẫn còn lỗi từ `mcp-loop` chưa pass, hoặc user chưa xác nhận UI ở `ui-checkpoint` (nếu task có UI).

**Checkpoint giữa chừng (tùy chọn):** có thể gọi `/opsx:sync` sau vài task để merge sớm delta spec vào spec chính, không cần chờ đến khi xong hết `tasks.md`.

**Hoàn tất change (sau khi `/opsx:verify` pass):**

4. Đảm bảo đã commit hết các task còn lại.
5. Gọi `/opsx:sync` (nếu chưa sync lần nào) rồi `/opsx:archive` để merge delta spec vào `openspec/specs/` chính thức và chuyển change vào `changes/archive/`. Đây là bước OpenSpec quản lý, KHÔNG tự chạy raw `openspec archive` qua bash để thay thế.
6. Commit cuối cùng ghi nhận archive (nếu OpenSpec tạo thay đổi file cần commit thêm sau archive).

## Xử lý "Undo / Quay lại"

Khi user nói kiểu: *"Bỏ tính năng Login đi"*, *"Quay lại lúc chưa có Cart"*, *"Undo cái vừa làm"*:

1. **Không đọc lại code để tự xóa thủ công.** Chạy `git log --oneline` để tìm commit ngay trước khi thêm tính năng cần bỏ.
2. Xác nhận với user (ngắn gọn) hash/commit message tìm được đúng là điểm cần quay lại chưa, tránh reset nhầm.
3. Thực hiện:
   - Nếu muốn bỏ hẳn thay đổi chưa commit hoặc mới nhất: `git reset --hard <hash>`.
   - Nếu muốn giữ lịch sử (an toàn hơn, khuyến nghị mặc định): `git revert <hash>` hoặc tạo branch mới từ hash cũ thay vì `reset --hard` phá lịch sử.
4. Sau khi reset/revert, chạy lại `mcp-loop/SKILL.md` một lần để xác nhận app vẫn chạy được ở trạng thái vừa quay lại.
5. Nếu change chưa được archive (còn nằm trong `openspec/changes/<change-name>/`), xóa/hủy luôn thư mục change đó thay vì chỉnh sửa spec đã archive. Nếu change ĐÃ archive rồi (đã merge vào `openspec/specs/`), tạo 1 change mới kiểu "revert" để đảo ngược phần spec đó cho đúng quy trình OpenSpec, không sửa tay trực tiếp vào `specs/` đã archive.

## Lưu ý an toàn

- Mặc định ưu tiên `git revert`/branch mới hơn `git reset --hard` để không mất lịch sử vĩnh viễn, trừ khi user nói rõ muốn xóa hẳn.
- Không tự động push lên remote trừ khi user yêu cầu - checkpoint là local trước.
- Nếu working tree đang dirty (có thay đổi chưa commit ngoài luồng) trước khi reset, cảnh báo user trước khi thực hiện, tránh mất code chưa lưu ngoài ý muốn.
