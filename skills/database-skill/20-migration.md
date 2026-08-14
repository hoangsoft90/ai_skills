# 20 Migration — Expand-Contract, Safety, SQLite Recreate

## 🎯 Trigger

Load khi: thay đổi schema (ALTER, ADD COLUMN, DROP), tạo migration script, deploy migration lên staging/production.

---

## 1. Always / Never

### Always

- Backup trước migration (xem `00-safety.md`)
- Migration phải **idempotent** (`IF NOT EXISTS` / `IF EXISTS` / `ON CONFLICT`)
- Migration phải **backward compatible** (code cũ vẫn chạy được)
- Mỗi migration cần `up.sql` + `down.sql` (hoặc lý do tại sao không rollback được)
- Chạy `--dry-run` trước khi execute thật

### Never

- ❌ DROP column ngay — phải expand-contract
- ❌ RENAME column — code cũ dùng tên cũ sẽ fail
- ❌ Chạy trực tiếp production không backup
- ❌ Một migration quá lớn (không rollback được nếu fail giữa chừng)
- ❌ Alter column type không kiểm tra dữ liệu hiện tại

---

## 2. Expand → Migrate → Contract (zero-downtime)

Dùng cho mọi thay đổi schema nguy hiểm (rename, drop, change type).

### Phase 1: ADD (forward compatible)

```sql
-- Thêm column mới, code cũ không bị ảnh hưởng
ALTER TABLE users ADD COLUMN display_name TEXT;
```

- Schema: thêm column mới
- Code: ghi cả column cũ + mới
- Deploy: không downtime

### Phase 2: Migrate (backfill data)

```sql
-- Migrate data từ old → new (batch)
UPDATE users
SET display_name = name
WHERE display_name IS NULL
LIMIT 1000;
```

- Chạy batch, có checkpoint
- Có thể chạy background job

### Phase 3: Code chỉ dùng column mới

- Update code: đọc/ghi column mới
- Deploy: code cũ không còn reference column cũ

### Phase 4: DROP column cũ

```sql
-- Chỉ drop sau khi chắc chắn code không còn dùng
ALTER TABLE users DROP COLUMN name;
```

### Ví dụ rename column đúng

```sql
-- ❌ SAI: rename trực tiếp (code cũ chết)
ALTER TABLE users RENAME COLUMN name TO display_name;

-- ✅ ĐÚNG: expand-contract
-- Phase 1: ADD display_name
ALTER TABLE users ADD COLUMN display_name TEXT;
-- Phase 2: code ghi cả 2, backfill dữ liệu
UPDATE users SET display_name = name WHERE display_name IS NULL;
-- Phase 3: code chỉ dùng display_name (deploy)
-- Phase 4: DROP name
ALTER TABLE users DROP COLUMN name;
```

---

## 3. down.sql + --dry-run bắt buộc

### down.sql

Mỗi migration phải có up.sql + down.sql:

```sql
-- 001_add_display_name.up.sql
ALTER TABLE users ADD COLUMN display_name TEXT;

-- 001_add_display_name.down.sql
ALTER TABLE users DROP COLUMN display_name;
```

Lý do tại sao không rollback được (nếu có):

```sql
-- 002_drop_old_name.up.sql
ALTER TABLE users DROP COLUMN name;

-- 002_drop_old_name.down.sql
-- ⚠️ KHÔNG THỂ rollback: mất dữ liệu
-- Giải pháp: chạy backup trước, restore nếu cần
```

### --dry-run

Trước khi execute migration, chạy dry-run:

```python
# ✅ ĐÚNG: dry-run trước khi execute
if not args.force:
    print("=== DRY RUN ===")
    print(f"Will execute: {migration_file}")
    print("Changes:")
    for change in get_changes():
        print(f"  {change}")
    print("==============")
    response = input("Continue? (yes/no): ")
    if response != "yes":
        return
```

**Production quy tắc:**
- Agent **KHÔNG ĐƯỢC** tự động chạy migration production
- Agent chỉ tạo file `.sql` (up + down)
- Output: `001_add_display_name.up.sql`, `001_add_display_name.down.sql`
- User tự review và execute

---

## 4. Idempotent

```sql
-- ✅ ĐÚNG: idempotent
CREATE TABLE IF NOT EXISTS users (...);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
DROP INDEX IF EXISTS idx_users_old;

-- ❌ SAI: fail nếu chạy lần 2
CREATE TABLE users (...);
ALTER TABLE users ADD COLUMN display_name TEXT;
```

---

## 5. DB-specific migration

### SQLite

SQLite **không support `ALTER COLUMN`** và **DROP COLUMN hạn chế** (3.25+ mới có).

**Cách migrate an toàn trên SQLite:**

```sql
-- 1. Tạo bảng mới với schema đúng
CREATE TABLE users_new (
    id INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

-- 2. Copy dữ liệu
INSERT INTO users_new (id, display_name, email, created_at)
SELECT id, COALESCE(display_name, name), email, created_at FROM users;

-- 3. Drop bảng cũ
DROP TABLE users;

-- 4. Rename bảng mới
ALTER TABLE users_new RENAME TO users;

-- 5. Tạo lại index, FK
```

Sqlite có thể dùng `PRAGMA user_version` để track migration version.

### MySQL

- DDL gây **implicit COMMIT** — không thể rollback
- ALTER TABLE có thể lock — dùng `ALGORITHM=INPLACE, LOCK=NONE`

```sql
-- MySQL: ALTER không lock
ALTER TABLE users
ADD COLUMN display_name TEXT,
ALGORITHM=INPLACE,
LOCK=NONE;
```

### PostgreSQL

- DDL **rollback được** — có thể bọc trong transaction
- `CREATE INDEX CONCURRENTLY` — không được trong transaction

```sql
-- PostgreSQL: DDL an toàn
BEGIN;
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD CONSTRAINT uq_users_display_name UNIQUE (display_name);
COMMIT;

-- Chạy ngoài transaction
CREATE INDEX CONCURRENTLY idx_users_display_name ON users (display_name);
```

---

## 6. Migration file naming

```
{version}_{description}.{direction}.sql
```

Ví dụ:
```
001_create_users.up.sql
001_create_users.down.sql
002_add_display_name.up.sql
002_add_display_name.down.sql
003_create_orders.up.sql
003_create_orders.down.sql
```

Version = timestamp hoặc số thứ tự tăng dần. Không dùng `V1`, `V2` (dễ conflict khi merge).

---

## Checklist — trước khi ship migration

- [ ] `down.sql` sẵn sàng (hoặc lý do không rollback được)?
- [ ] Đã chạy `--dry-run`?
- [ ] Đã test trên staging?
- [ ] Backup complete?
- [ ] Idempotent (`IF NOT EXISTS`)?
- [ ] Backward compatible (code cũ không break)?
- [ ] Expand-contract nếu nguy hiểm?
- [ ] Batch migrate nếu data > 10k rows?
- [ ] SQLite: có recreate table plan?
- [ ] PostgreSQL: concurrent index ngoài transaction?

---

## Liên kết

- `00-safety.md` — backup, environment guard
- `dialects/*.md` — DB-specific migration syntax
- `31-testing-seed.md` — rollback test, migration test
