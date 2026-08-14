---
name: database
description: Use when designing schema, writing migrations, writing transactions/concurrent code, optimizing queries, reviewing SQL or ORM code, or seeding/testing data for SQLite, MySQL, or PostgreSQL. Covers safety guards for destructive operations (DROP/TRUNCATE/ALTER), schema/data-type mapping across the three dialects, transaction and locking correctness, migration rollback safety, indexing/EXPLAIN-based query optimization, and evidence-based code review. Trigger this whenever a task touches a database connection, schema, SQL statement, or ORM query for any of these three engines.
---

# Database Skill — Entrypoint & Router

## 🎯 Mục đích

Skill này hướng dẫn CLI Agent thao tác đúng với SQLite, MySQL, PostgreSQL. Entrypoint duy nhất — không load toàn bộ thư mục vào context. Chỉ load file theo trigger rules bên dưới.

### ⛔ Quy tắc nạp file (bắt buộc)

Chỉ `view`/đọc file trong `dialects/` hoặc file `00-`–`40-` khi đã xác định rõ trigger tương ứng ở bảng dưới. **Không** liệt kê thư mục rồi đọc lần lượt "cho chắc". Nếu task không khớp trigger nào, chỉ dùng 6 Golden Rules + Compatibility Matrix ngay trong file này — không mở thêm file.

---

## ⚠️ 6 Golden Rules (luôn áp dụng, không cần load thêm file)

1. **Never guess schema** — nếu chưa inspect hoặc không chắc chắn schema/kiểu dữ liệu thực tế, **cấm** viết DDL/DML. Bắt buộc chạy `PRAGMA table_info` / `SHOW CREATE TABLE` / `\d+` trước, không suy đoán từ tên cột hay convention "thường thấy"
2. **Environment isolation** — `NODE_ENV=production` cần `--force` + human confirm + backup
3. **Parameterized only** — cấm string concatenation trong SQL
4. **No FLOAT for money** — INTEGER cents / DECIMAL / NUMERIC
5. **Idempotence required** — migration & seed chạy lại được nhiều lần không lỗi
6. **Always have down path** — mọi migration phải có rollback script (hoặc lý do rõ ràng tại sao không rollback được)

---

## 🚦 Trigger Rules (khi nào load file nào)

| Khi agent nhận yêu cầu | Load các file |
|---|---|
| Tạo bảng / thiết kế schema | `00-safety.md` + `10-schema-design.md` + `dialects/{db}.md` |
| ALTER / DROP / migration | `00-safety.md` + `20-migration.md` + `dialects/{db}.md` |
| Transaction / logic tiền / giao dịch | `11-transactions.md` + `12-concurrency.md` |
| Query chậm / tối ưu hiệu năng | `21-indexing-query.md` + `dialects/{db}.md` |
| Code review (bất kỳ) | `30-review.md` |
| Seed / test dữ liệu | `31-testing-seed.md` |
| Cần pattern phổ biến | `40-patterns.md` |
| Mọi DDL nguy hiểm | `00-safety.md` bắt buộc trước khi load bất kỳ file nào khác |

---

## 🔷 Compatibility Matrix (tra cứu nhanh, không cần load dialect)

| Feature | SQLite | MySQL 8+ | PostgreSQL 16+ |
|---|---|---|---|
| RETURNING | ✔ | ✔ (8.0.14+) | ✔ |
| JSON | TEXT (qua JSON functions) | JSON | **JSONB** (luôn dùng) |
| Partial Index | ✔ | ✘ | ✔ |
| Concurrent Index BUILD | ✘ | ✔ (chậm) | `CREATE INDEX CONCURRENTLY` |
| DDL in Transaction | Không (implicit commit) | Không (implicit commit) | ✔ (rollback được) |
| `SKIP LOCKED` | ✘ | ✔ | ✔ |
| Native UUID | TEXT | `BINARY(16)` / `CHAR(36)` | UUID |
| Generated Identity | `AUTOINCREMENT` | `AUTO_INCREMENT` | `GENERATED ... AS IDENTITY` |
| FK constraint | Cần `PRAGMA foreign_keys=ON` | Tự động | Tự động |
| `ALTER COLUMN` | ❌ (phải recreate table) | ✔ (hạn chế) | ✔ |
| Materialized View | ✘ | ✘ | ✔ |
| Advisory Lock | ✘ | ✔ (`GET_LOCK()`) | ✔ (`pg_advisory_lock`) |

---

## 🔐 Agent Capability & Permission Boundary

| Thao tác | Dev / Staging | Production | Ghi chú |
|---|---|---|---|
| Inspect / EXPLAIN / SELECT | ✅ Auto | ✅ Auto | Production bắt buộc `LIMIT ≤ 100` |
| Generate migration / DDL | ✅ Output file | ✅ Output file | Chỉ ghi file, không tự execute |
| Execute migration (`up`) | ⚠️ Cần `--dry-run` trước | 🛑 Cần human confirm + `--force` + backup | |
| Execute `down` / rollback | ⚠️ Cần `--dry-run` trước | 🛑 Cần human confirm | |
| `DROP` / `TRUNCATE` / xoá hàng loạt không `WHERE` | ⚠️ Cần `--dry-run` + xác nhận | ⛔ **NEVER tự động** | Chỉ khi human gõ rõ lệnh xác nhận, không suy diễn từ "gấp"/"nhanh lên" |
| Seed / fixture data | ✅ | ⛔ **NEVER** | Xem `31-testing-seed.md` |

## 🔢 Version check bắt buộc

Trước khi dùng bất kỳ tính năng nào trong Compatibility Matrix bên dưới (ví dụ RETURNING, JSONB, CONCURRENTLY), chạy `SELECT VERSION()` / `SELECT version()` / `PRAGMA user_version` để xác nhận version thật của server đang kết nối. Không giả định "chắc là bản mới" dựa vào tên project hay ngày tạo file.

---

## 📂 Cấu trúc thư mục

```
database-skill/
├── SKILL.md                 # <-- file này
├── 00-safety.md             # Env guard, destructive ops, 3 modes
├── 10-schema-design.md      # Schema, constraints, Data Types Matrix
├── 11-transactions.md       # Transaction, isolation, ORM boundary
├── 12-concurrency.md        # Locking, Deadlock Retry Loop
├── 20-migration.md          # Expand-Contract, down.sql, dry-run
├── 21-indexing-query.md     # EXPLAIN, cost-based triggers, N+1
├── 30-review.md             # Checklist review SQL + ORM
├── 31-testing-seed.md       # Seed idempotent + rollback test
├── 40-patterns.md           # Decision trees + common patterns
└── dialects/
    ├── sqlite.md
    ├── mysql.md
    └── postgres.md
```

---

## Quy trình khi nhận task

1. Xác định DB đang dùng (SQLite / MySQL / PostgreSQL)
2. Kiểm tra môi trường (`NODE_ENV`, `DATABASE_URL`)
3. Xác định task type → Trigger Rules → load file tương ứng
4. Tuyệt đối không load toàn bộ thư mục vào context
