# 00 Safety — Environment Guard & Destructive Operation Protection

## 🎯 Trigger

Load file này **bắt buộc** trước mọi thao tác DDL nguy hiểm: `DROP`, `TRUNCATE`, `ALTER` mất dữ liệu, `DELETE` không `WHERE`. Cũng load khi cần tìm connection string hoặc kiểm tra môi trường.

---

## 1. Cách tìm connection string

Thứ tự ưu tiên:

1. `DATABASE_URL` trong `.env`
2. Biến môi trường: `DATABASE_URL`, `DB_URL`, `POSTGRES_URL`, `MYSQL_URL`
3. File cấu hình: `docker-compose.yml`, `config/database.yml`, `prisma/schema.prisma`
4. Hỏi user nếu không tìm thấy

Kiểm tra DB type từ connection string:

| Bắt đầu bằng | DB |
|---|---|
| `sqlite://` | SQLite |
| `mysql://` | MySQL |
| `postgres://` / `postgresql://` | PostgreSQL |
| File `.db` / `.sqlite` | SQLite |

---

## 2. Environment guard

### Luôn kiểm tra môi trường trước DDL

```bash
# Bắt buộc kiểm tra
echo $NODE_ENV      # production / staging / development
echo $APP_ENV
echo $RAILS_ENV
```

### Cấm tuyệt đối trên production nếu không có --force + human confirm

```sql
-- ❌ SAI: chạy trực tiếp trên production
DROP TABLE users;

-- ✅ ĐÚNG: kiểm tra môi trường trước
-- NODE_ENV=production? Dừng lại, yêu cầu --force flag
```

### Quy tắc:

- `NODE_ENV=production` + không `--force` → **TỪ CHỐI CHẠY**, chỉ tạo file SQL
- `NODE_ENV=production` + `--force` → **BẮT BUỘC backup trước** + confirm từ user
- `NODE_ENV=development` → cho phép chạy, nhưng vẫn kiểm tra destructive ops

---

## 3. 3 Operation Modes

### 🔵 READ mode

- Chỉ `SELECT`, không DDL/DML
- Bắt buộc `LIMIT` — nếu user không specify, mặc định `LIMIT 100`
- Query nặng → chạy `EXPLAIN` trước
- Nên dùng read-only connection nếu có (`transaction_read_only`)

```sql
-- ✅ ĐÚNG: luôn có LIMIT
SELECT id, name, email FROM users WHERE status = 'active' LIMIT 100;

-- ❌ SAI: không LIMIT
SELECT * FROM users;
```

### 🟡 MIGRATE mode

- Bắt buộc backup trước (xem section 4)
- Bắt buộc idempotent (`IF NOT EXISTS`, `ON CONFLICT`)
- Bắt buộc `--dry-run` trước khi execute thật
- Bắt buộc rollback script (`down.sql`)
- Production → chỉ tạo file `.sql`, không tự động chạy

### 🟢 SEED/AUDIT mode

- Dùng `UPSERT` / `ON CONFLICT` — không `INSERT` thuần (tránh duplicate)
- Kiểm tra dữ liệu có logic: `created_at <= updated_at`, `balance >= 0`
- **KHÔNG BAO GIỜ** seed production
- Nếu không chắc môi trường → chạy dry-run trước

---

## 4. Backup trước migration

### PostgreSQL

```bash
pg_dump -Fc dbname > backup_$(date +%Y%m%d_%H%M%S).dump
pg_dump dbname > backup.sql
```

### MySQL

```bash
mysqldump dbname > backup_$(date +%Y%m%d_%H%M%S).sql
```

### SQLite

```bash
cp database.db database.db.backup_$(date +%Y%m%d_%H%M%S)
```

### Kiểm tra backup thành công

```bash
# PostgreSQL
pg_restore -l backup.dump >/dev/null 2>&1 && echo "OK" || echo "FAIL"

# MySQL
head -5 backup.sql | grep -q "CREATE DATABASE" && echo "OK" || echo "FAIL"

# SQLite
sqlite3 database.db.backup "PRAGMA integrity_check;" && echo "OK" || echo "FAIL"
```

---

## 5. Connection safety

### SQLite

```sql
-- BẮT BUỘC mỗi connection mới
PRAGMA foreign_keys = ON;      -- nếu không FK vô dụng
PRAGMA journal_mode = WAL;     -- concurrent read an toàn hơn
PRAGMA busy_timeout = 5000;    -- chờ 5s thay vì fail ngay
```

- SQLite single-writer — không concurrent write
- `WAL` mode cho phép concurrent read + write
- `busy_timeout` tránh `SQLITE_BUSY` nếu write conflict nhẹ

### MySQL

```sql
-- Kiểm tra max_connections
SHOW VARIABLES LIKE 'max_connections';

-- Connection pool khuyến nghị
-- pool_size = min(10, max_connections - 10)
-- wait_timeout = 600s
```

- `ALTER TABLE` thường lock table — dùng `ALGORITHM=INPLACE, LOCK=NONE`
- MySQL DDL gây implicit commit — không tách được transaction cho schema change

### PostgreSQL

```sql
-- Kiểm tra connection limit
SHOW max_connections;
SHOW shared_buffers;
```

- Khi scale > 50 connections → cần PgBouncer / pgpool
- `max_connections` mặc định 100 — tăng cẩn thận (mỗi connection ~10MB RAM)
- PgBouncer transaction pooling cho serverless

---

## 6. Checklist an toàn — trước khi execute

- [ ] Đã xác định đúng môi trường (dev/staging/prod)?
- [ ] Đã inspect schema hiện tại?
- [ ] Đã backup?
- [ ] Có `--force` nếu production?
- [ ] DDL có idempotent (`IF NOT EXISTS`)?
- [ ] Có rollback plan?
- [ ] Connection string đúng DB?
- [ ] `PRAGMA foreign_keys=ON` (SQLite)?

---

## Liên kết

- `20-migration.md` — expand-contract, down.sql, dry-run chi tiết
- `dialects/*.md` — connection đặc thù từng DB
