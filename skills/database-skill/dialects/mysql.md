# MySQL Dialect — InnoDB, utf8mb4, Implicit Commit, ALTER Lock

## 🎯 Trigger

Load khi: DB là MySQL (8+), cần biết syntax khác, implicit commit, ALTER behavior.

---

## 1. Always

```sql
-- Engine: InnoDB (luôn)
ENGINE = InnoDB;

-- Charset: utf8mb4_0900_ai_ci (MySQL 8+, không dùng utf8mb3)
CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

### Cấu hình connection

```sql
SET SESSION time_zone = '+00:00';              -- UTC
SET SESSION sql_mode = 'STRICT_TRANS_TABLES';  -- strict mode
```

---

## 2. Supports (MySQL 8.0+)

| Feature | Notes |
|---|---|
| JSON | Native JSON type, JSON functions |
| CTE (`WITH`) | MySQL 8.0.1+ |
| Window functions | MySQL 8.0.2+ |
| Invisible Index | Test xóa index không phá |
| `SKIP LOCKED` | MySQL 8.0.1+ |
| `NOWAIT` | MySQL 8.0.1+ |
| Generated Column | ✔ |
| `RETURNING` | MySQL 8.0.21+ |
| Partial Index | ❌ Không support |
| Descending Index | ✔ (MySQL 8.0+) |
| Full-text Index | ✔ InnoDB |

---

## 3. Not support / Cẩn thận

| Feature | MySQL behavior |
|---|---|
| Partial Index | Không — dùng virtual column + index |
| `FULL OUTER JOIN` | UNION LEFT JOIN + RIGHT JOIN |
| Full-text search in transaction | InnoDB full-text search có limitation |
| `DISTINCT` với `ORDER BY` expression | Cẩn thận khi không dùng alias |
| DDL rollback | DDL gây implicit COMMIT — không rollback được |

---

## 4. Implicit COMMIT — Nguy hiểm nhất

MySQL tự động COMMIT khi gặp DDL:

```sql
-- Transaction này bị COMMIT ngay khi gặp DDL
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
ALTER TABLE accounts ADD COLUMN note TEXT;  -- ← IMPLICIT COMMIT ở đây
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- đây là transaction mới!
COMMIT;
```

**Quy tắc:**
- Không trộn DDL vào transaction ghi dữ liệu
- Chạy DDL riêng, không chung với DML
- Nếu cần ALTER, kill transaction trước

---

## 5. ALTER TABLE lock behavior

```sql
-- Mặc định: ALTER lock table → block writes
-- Giải pháp: ALGORITHM=INPLACE, LOCK=NONE

-- ✅ ĐÚNG: ALTER không block
ALTER TABLE users
ADD COLUMN display_name VARCHAR(255),
ALGORITHM=INPLACE,
LOCK=NONE;

-- Kiểm tra trước khi ALTER
ALTER TABLE users
ADD COLUMN display_name VARCHAR(255),
ALGORITHM=INPLACE,
LOCK=NONE;
```

### ALTER theo operation

| Operation | ALGORITHM | LOCK | Notes |
|---|---|---|---|
| ADD COLUMN | INPLACE | NONE | OK cho hầu hết |
| DROP COLUMN | INPLACE | NONE | MySQL 8.0.14+ |
| ADD INDEX | INPLACE | NONE | |
| DROP INDEX | INPLACE | NONE | |
| CHANGE COLUMN type | COPY | SHARED/EXCLUSIVE | Có thể phải rebuild table |
| RENAME COLUMN | INPLACE | NONE | MySQL 8.0+ |

---

## 6. Important syntax differences

### String comparison

```sql
-- MySQL: case-insensitive by default (utf8mb4_0900_ai_ci)
SELECT * FROM users WHERE email = 'TEST@EXAMPLE.COM';  -- tìm được 'test@example.com'

-- Cần case-sensitive: dùng COLLATE
SELECT * FROM users WHERE email COLLATE utf8mb4_bin = 'Test@Example.com';
-- Hoặc: dùng BINARY
SELECT * FROM users WHERE BINARY email = 'Test@Example.com';
```

### LIMIT

```sql
-- MySQL: LIMIT có thể không kèm ORDER BY
SELECT * FROM users LIMIT 100;  -- OK (nhưng không guarantee order)

-- Tốt nhất: luôn ORDER BY
SELECT * FROM users ORDER BY id LIMIT 100;
```

### ON DUPLICATE KEY UPDATE

```sql
INSERT INTO users (id, email, name)
VALUES (1, 'a@b.com', 'A')
ON DUPLICATE KEY UPDATE
    email = VALUES(email),
    name = VALUES(name);
```

### Invisible Index

```sql
-- Test xóa index không ảnh hưởng performance
ALTER TABLE users ALTER INDEX idx_users_email INVISIBLE;
-- Monitor query performance → không ảnh hưởng? DROP
ALTER TABLE users DROP INDEX idx_users_email;
-- Ảnh hưởng? VISIBLE lại
ALTER TABLE users ALTER INDEX idx_users_email VISIBLE;
```

---

## 7. Performance & Best Practices

### InnoDB buffer pool

```sql
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
-- Khuyến nghị: 70-80% RAM for dedicated DB server
```

### Connection

```sql
SHOW VARIABLES LIKE 'max_connections';
SHOW VARIABLES LIKE 'wait_timeout';

-- Khuyến nghị pool
-- pool_size = min(10, max_connections - 10)
-- wait_timeout = 600
```

### Transaction isolation

```sql
-- MySQL InnoDB mặc định: REPEATABLE READ
-- Chuyển sang READ COMMITTED nếu cần
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

---

## 8. Anti-patterns

| Anti-pattern | Vấn đề | Fix |
|---|---|---|
| `utf8mb3` (MySQL legacy utf8) | Không full Unicode | `utf8mb4_0900_ai_ci` |
| MyISAM engine | No FK, no transaction, table-level lock | InnoDB |
| DDL trong transaction | Implicit COMMIT | Tách DDL riêng |
| ALTER không ALGORITHM/LOCK | Block writes | `ALGORITHM=INPLACE, LOCK=NONE` |
| `FLOAT` cho money | Sai số cent | `DECIMAL(19,4)` |
| Auto-increment gap | InnoDB không guarantee contiguous | Chấp nhận gap |

---

## 9. Checklist

- [ ] Engine = InnoDB?
- [ ] Charset = utf8mb4_0900_ai_ci?
- [ ] DDL không chung transaction với DML?
- [ ] ALTER dùng `ALGORITHM=INPLACE, LOCK=NONE`?
- [ ] Dùng DECIMAL cho money?
- [ ] Thời gian zone UTC?
- [ ] SQL mode STRICT?

---

## Liên kết

- `00-safety.md` — MySQL connection safety
- `11-transactions.md` — MySQL implicit commit
- `12-concurrency.md` — MySQL lock, SKIP LOCKED
- `20-migration.md` — MySQL migration
