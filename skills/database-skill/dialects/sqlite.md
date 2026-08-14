# SQLite Dialect — WAL, PRAGMA, STRICT, Giới hạn

## 🎯 Trigger

Load khi: DB là SQLite, cần biết giới hạn, syntax khác MySQL/PG.

---

## 1. Always — PRAGMA mỗi connection mới

```sql
-- BẮT BUỘC: mỗi connection mới
PRAGMA foreign_keys = ON;       -- nếu không FK vô dụng
PRAGMA journal_mode = WAL;      -- concurrent read + write
PRAGMA busy_timeout = 5000;     -- 5s chờ thay vì fail ngay
PRAGMA synchronous = NORMAL;    -- cân bằng speed + safety (WAL + NORMAL)
```

Có thể set trong connection string: `sqlite:///db.sqlite?journal_mode=WAL&busy_timeout=5000`

---

## 2. Supports

| Feature | SQLite version |
|---|---|
| UPSERT (`ON CONFLICT DO UPDATE`) | 3.24.0+ |
| RETURNING | 3.35.0+ |
| WINDOW functions | 3.25.0+ |
| STRICT table | 3.37.0+ |
| Partial Index | ✔ (full) |
| Expression Index | ✔ |
| Generated Column | 3.31.0+ |
| CTE (WITH) | ✔ |
| CTE recursive | ✔ |
| JSON functions | 3.38.0+ (JSON1 extension) |
| `ALTER TABLE DROP COLUMN` | 3.35.0+ |
| `ALTER TABLE RENAME COLUMN` | 3.25.0+ |

---

## 3. Not support

| Feature | Thay thế |
|---|---|
| `ALTER COLUMN` (modify type) | Recreate table (xem "ALTER migration pattern" bên dưới) |
| `RIGHT JOIN` | Đảo table order + LEFT JOIN |
| `FULL OUTER JOIN` | UNION LEFT JOIN + RIGHT JOIN |
| `GRANT` / `REVOKE` | File permission |
| `BOOLEAN` native | INTEGER 0/1 |
| `DATETIME` / `TIMESTAMP` native | TEXT ISO8601 hoặc INTEGER unix timestamp |
| Stored procedures | Không, dùng application logic |
| `SELECT FOR UPDATE` | single-writer, không cần |
| Concurrent write | Chỉ 1 writer — WAL cho concurrent read |
| `TRUNCATE TABLE` | `DELETE FROM table` (không có TRUNCATE) |

---

## 4. Khác biệt syntax quan trọng

### STRICT table (SQLite 3.37+)

```sql
-- Mặc định SQLite không kiểm tra type nghiêm ngặt
-- STRICT mode bắt buộc đúng type như MySQL/PG
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL  -- 0/1
) STRICT;
```

### LIMIT/OFFSET — bắt buộc ORDER BY

```sql
-- ✅ ĐÚNG
SELECT * FROM users ORDER BY id LIMIT 20 OFFSET 40;

-- ❌ SAI: SQLite không guarantee thứ tự nếu không ORDER BY
SELECT * FROM users LIMIT 20 OFFSET 40;
```

### INSERT OR REPLACE

```sql
-- Cẩn thận: REPLACE = DELETE + INSERT → trigger DELETE cascade!
-- Dùng UPSERT thay vì INSERT OR REPLACE
INSERT OR REPLACE INTO users (id, email) VALUES (1, 'a@b.com');
```

### ALTER migration pattern

```sql
-- SQLite không modify column trực tiếp
-- Pattern: CREATE → INSERT → DROP → RENAME
CREATE TABLE users_new (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

INSERT INTO users_new (id, email, name, display_name, created_at)
SELECT id, email, name, COALESCE(display_name, name), created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
```

---

## 5. Anti-patterns

| Anti-pattern | Vấn đề | Fix |
|---|---|---|
| Dùng SQLite như PostgreSQL | Concurrent write | WAL + busy_timeout + BEGIN IMMEDIATE |
| Quên `PRAGMA foreign_keys=ON` | FK không hoạt động | Set mỗi connection |
| `INSERT OR REPLACE` với FK | Cascade delete | Dùng `ON CONFLICT DO UPDATE` |
| Không `STRICT` | Kiểu dữ liệu lỏng lẻo | Dùng `STRICT` mode hoặc validate app layer |
| `SELECT *` không `ORDER BY LIMIT` | Không predict được | Luôn ORDER BY + LIMIT |

---

## 6. Performance tips

- `WAL` mode: 3-5x nhanh hơn `DELETE` mode
- `PRAGMA synchronous = NORMAL` thay vì FULL (WAL + NORMAL vẫn an toàn)
- B-tree: SQLite index là B-tree, composite index order quan trọng
- `EXPLAIN QUERY PLAN` — ít chi tiết hơn PG, nhưng đủ detect Seq Scan
- `ANALYZE` — thu thập statistics cho query optimizer

---

## 7. Checklist

- [ ] `PRAGMA foreign_keys=ON`?
- [ ] `PRAGMA journal_mode=WAL`?
- [ ] `PRAGMA busy_timeout=5000`?
- [ ] `BEGIN IMMEDIATE` cho write transaction?
- [ ] UPSERT thay `INSERT OR REPLACE`?
- [ ] ALTER column có recreate table pattern?
- [ ] `STRICT` mode bật?
- [ ] FK không hoạt động nếu quên PRAGMA?

---

## Liên kết

- `00-safety.md` — SQLite connection safety
- `20-migration.md` — SQLite recreate table migration
- `database-skill/SKILL.md` — Compat Matrix
