---
name: project-orchestrator
description: Điều phối toàn bộ quy trình làm app Flutter bằng AI - từ đọc OpenSpec, quyết định có cần migration không, sinh code, chạy MCP auto-fix, xin duyệt UI, đến commit git. LUÔN dùng skill này đầu tiên khi user yêu cầu thêm/sửa tính năng cho app Flutter, kể cả khi họ chỉ nói ngắn gọn như "thêm màn hình đăng nhập" hay "làm app bán trà sữa". Đây là checklist điều phối, không tự viết code.
---

# Project Orchestrator

Đây là skill điều phối duy nhất mà agent load ĐẦU TIÊN cho mọi yêu cầu liên quan đến app Flutter trong project. Nó không viết code, chỉ quyết định bước tiếp theo và load đúng 1 skill con tương ứng.

## Nguyên tắc

- Một Agent CLI duy nhất, không spawn agent con, không mô phỏng multi-agent.
- Mỗi bước chỉ load đúng 1 skill con cần thiết, không load tất cả cùng lúc (tránh loãng context).
- OpenSpec (CLI thật của Fission-AI, không phải 1 file .md đơn) là nguồn sự thật duy nhất:
  - `openspec/specs/<domain>/spec.md` — hành vi hiện tại của hệ thống (source of truth).
  - `openspec/changes/<change-name>/{proposal.md, design.md, tasks.md, specs/<domain>/spec.md}` — đề xuất thay đổi đang làm dở (delta spec).
  - `openspec/config.yaml` — context/tech stack cố định (Flutter, Riverpod, GoRouter, Feature-First) và rules, được tự động inject vào mọi artifact, KHÔNG cần agent tự nhắc lại các rule này mỗi lần.
- **QUAN TRỌNG - phân định trách nhiệm:** `flutter-skill` KHÔNG được tự ý đọc/ghi trực tiếp vào `openspec/specs/` hay `openspec/changes/` bằng cách tự bịa thao tác file, và KHÔNG tự chạy raw `openspec` CLI qua bash để thay thế vòng đời spec. Toàn bộ vòng đời change (tạo, sinh artifact, thực thi, validate, merge) PHẢI đi qua slash command `/opsx:*` đã cấu hình (profile mở rộng: `new`, `continue`, `ff`, `propose`, `explore`, `apply`, `verify`, `sync`, `archive`, `bulk-archive`, `onboard`). `flutter-skill` là **kỹ thuật Flutter cụ thể** được dùng BÊN TRONG các bước đó (đặc biệt là trong `/opsx:apply`), không phải lớp thay thế chúng.
- Không hỏi lại user những thứ có thể suy ra từ `config.yaml`/`specs/` hiện có hoặc dùng mặc định hợp lý (xem phần "Quy tắc mặc định" bên dưới), NHƯNG luôn hỏi user ở bước UI-checkpoint (trong bước 4, mỗi khi task có UI) - đây là điểm dừng có chủ đích, không phải điểm dừng do thiếu thông tin.

## Quy trình (checklist tuần tự, map đúng vào vòng đời opsx thật)

### Giai đoạn Planning (opsx tự lo, flutter-skill chỉ đọc kết quả)

0. Nếu chưa rõ hướng đi → `/opsx:explore` để bàn trước (không tạo file). Nếu đã rõ → `/opsx:new <ten-change>` để tạo scaffold, rồi `/opsx:ff` (nhanh, sinh hết artifact 1 lần) hoặc `/opsx:continue` (từng bước, review kỹ hơn) để có đủ `proposal.md` + `specs/` (delta) + `design.md` + `tasks.md`. Nếu muốn gộp 2 bước làm 1: dùng `/opsx:propose <ten-change>` thay cho `new` + `ff`.
   - `flutter-skill` KHÔNG tự viết `proposal.md`/`tasks.md` thay cho opsx.

1. Đọc kết quả: `tasks.md` (danh sách việc cần làm) + delta `specs/<domain>/spec.md` (yêu cầu/data model mới) trong `changes/<change-name>/`.

1.5. Load `git-checkpoint/SKILL.md` phần "Branch theo từng change" — tạo/chuyển sang branch `change/<change-name>` NGAY trước khi đụng vào code, không code thẳng trên `main`.

2. **So sánh Data Model** giữa delta spec (bước 1) và spec đã archive (`openspec/specs/<domain>/spec.md`).
   - Nếu có thay đổi field/bảng → load `schema-migration/SKILL.md` TRƯỚC KHI vào giai đoạn Implementation.
   - Nếu không đổi model → bỏ qua, sang bước 3.

3. Load `architecture/SKILL.md` + `design-system/SKILL.md` để xác nhận blueprint/token trước khi code (không tự quyết định lại nếu đã khóa trong `config.yaml`).

### Giai đoạn Implementation — chạy BÊN TRONG `/opsx:apply`

4. Gọi `/opsx:apply` để bắt đầu thực thi `tasks.md`. Với MỖI task trong danh sách:
   - Nếu task cần logic phía server (tính toán tiền, phân quyền phức tạp, webhook, cron - xem điều kiện chi tiết trong `backend-coding/SKILL.md`) → load `backend-coding/SKILL.md` TRƯỚC, viết schema/RLS/Edge Function xong mới sang bước code Flutter. Nếu task chỉ là CRUD đơn giản → bỏ qua bước này, `flutter-coding` tự gọi Supabase client SDK trực tiếp.
   - Load `flutter-coding/SKILL.md` để sinh code Flutter cho task đó (dựa trên `agent-plugins`, tuân theo architecture/design-system, gọi đúng RPC/Edge Function/table vừa tạo nếu có).
   - Load `mcp-loop/SKILL.md` để build/chạy/tự sửa lỗi ngay sau khi code xong task đó (tối đa 5 lần lặp) - test cả luồng client gọi backend thật, không chỉ UI.
   - Nếu lỗi lặp do API/package deprecated → `rag-fallback/SKILL.md`, thử tối đa 2 lần nữa.
   - Đánh dấu task hoàn thành trong `tasks.md` (theo đúng cơ chế `/opsx:apply` đang track), rồi sang task tiếp theo.
   - Nếu 1 task có phần UI đáng kể → load `ui-checkpoint/SKILL.md` ngay sau khi task đó pass MCP, hỏi user xác nhận trước khi coi task này là "done".

### Giai đoạn Đóng gói (opsx tự lo, flutter-skill chỉ trigger đúng lúc)

5. Sau khi TẤT CẢ task trong `tasks.md` pass (mcp-loop + ui-checkpoint đều OK) → gọi `/opsx:verify` để chạy validation gate cuối cùng của OpenSpec.

6. Nếu `/opsx:verify` pass → load `git-checkpoint/SKILL.md` để commit code, sau đó gọi `/opsx:sync` (merge delta spec vào spec chính, dùng cho checkpoint) rồi `/opsx:archive` (hoàn tất change, chuyển vào `changes/archive/`). Sau khi archive xong, `git-checkpoint` merge branch `change/<change-name>` vào `main` và xóa branch.
   - Có thể gọi `/opsx:sync` sớm hơn (giữa chừng, sau vài task) nếu muốn checkpoint nhỏ hơn - không bắt buộc chờ đến cuối.

7. **Chỉ khi user yêu cầu rõ ràng** ("build apk", "đóng gói") → load `release/SKILL.md`. Không tự động build mỗi lần archive xong.

## Quy tắc mặc định (Fallback Rules) - dùng khi `config.yaml`/`specs/` chưa nói rõ

Nên khai báo sẵn các mặc định này trong `openspec/config.yaml` (mục `context`/`rules`) để không phải lặp lại mỗi lần:

- Chưa chỉ định backend → mặc định Firebase (đơn giản nhất cho MVP).
- Chưa chỉ định state management → Riverpod (đã khóa trong architecture.md, không đổi giữa chừng).
- Chưa chỉ định style → Material 3, theo `design-system/SKILL.md`.
- Chưa chỉ định nền tảng build → mặc định APK (iOS cần máy Mac, hỏi lại nếu user yêu cầu iOS mà đang không phải Mac).

## 3 trường hợp PHẢI dừng và hỏi user (không tự động hóa)

1. Thiếu API key/credentials (Firebase, Google Maps...).
2. Lỗi compile lặp lại sau khi đã thử `mcp-loop` + `rag-fallback`.
3. Yêu cầu vượt khả năng môi trường hiện tại (build iOS trên Windows/Linux).

Ngoài 3 trường hợp trên và bước UI-checkpoint (trong bước 4, mỗi khi task có UI), agent chạy hết một lượt mà không dừng hỏi lặt vặt.
