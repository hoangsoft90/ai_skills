# 31 Testing & Seed — Kiểm thử Migration, Dữ liệu Mẫu

## 🎯 Trigger

Load khi: cần tạo seed data, viết migration test, kiểm thử rollback, audit dữ liệu.

---

## 1. Seed Data

### Always / Never

| Always | Never |
|---|---|
| Dùng `UPSERT` / `ON CONFLICT` | `INSERT` thuần (trùng lỗi) |
| Idempotent (chạy nhiều lần được) | Chạy production |
| Dữ liệu logic (`created_at <= updated_at`) | Dữ liệu vô lý (`balance = -100`) |
| FK tồn tại trong DB | Xóa seed không check |

### Idempotent Seed

```sql
-- ❌ SAI: INSERT thuần, chạy lần 2 lỗi duplicate
INSERT INTO users (id, email, name) VALUES (1, 'admin@example.com', 'Admin');

-- ✅ ĐÚNG: UPSERT
INSERT INTO users (id, email, name)
VALUES (1, 'admin@example.com', 'Admin')
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name;

-- SQLite: INSERT OR REPLACE (cẩn thận với FK cascade)
INSERT OR REPLACE INTO users (id, email, name)
VALUES (1, 'admin@example.com', 'Admin');

-- MySQL: REPLACE (tương tự, cẩn thận FK)
REPLACE INTO users (id, email, name)
VALUES (1, 'admin@example.com', 'Admin');
```

### Seed có logic

```sql
-- ✅ ĐÚNG: dữ liệu logic
INSERT INTO users (id, email, name, is_active, balance_cents, created_at, updated_at)
VALUES
    (1, 'admin@example.com', 'Admin', 1, 0, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
    (2, 'user@example.com', 'User', 1, 10000, '2024-06-01T00:00:00Z', '2024-06-01T00:00:00Z');

-- ✅ ĐÚNG: FK hợp lệ
INSERT INTO orders (id, user_id, total_cents, status, created_at)
VALUES
    (1, 1, 5000, 'completed', '2024-06-15T00:00:00Z'),
    (2, 2, 2500, 'pending', '2024-06-20T00:00:00Z');
```

### Seed data validation rules

- `created_at <= updated_at`
- `balance >= 0`
- `email` format hợp lệ
- FK point đến row có thật
- Không vi phạm `UNIQUE` constraint
- Không vi phạm `CHECK` constraint

### Cấm seed production

```python
# ✅ ĐÚNG: guard
if os.environ.get("NODE_ENV") == "production":
    print("ERROR: cannot seed production database")
    sys.exit(1)
```

### PII Sanitization khi clone data prod → staging/test

Khi nhiệm vụ là "lấy data thật từ production về seed staging/test" (rất phổ biến khi debug bug chỉ xảy ra với data thật), **không bao giờ copy PII nguyên bản**. Bắt buộc sanitize trước khi insert vào môi trường non-prod:

| Loại dữ liệu | Xử lý |
|---|---|
| Email | Anonymize: `user_{id}@example.internal` |
| Password / token / API key | Ghi đè bằng dummy hash cố định, không giữ hash thật |
| Số điện thoại | Mask (`0900***456`) hoặc dùng Faker sinh số giả |
| Tên đầy đủ, địa chỉ | Faker generator, không giữ giá trị thật |
| Số thẻ / tài khoản ngân hàng | Không bao giờ clone — luôn thay bằng giá trị test chuẩn của payment provider |

```sql
-- ✅ ĐÚNG: sanitize khi clone
UPDATE users_staging SET
    email = 'user_' || id || '@example.internal',
    phone = NULL,
    password_hash = '$2b$12$dummy.hash.for.testing.only';
```

Rule cứng: nếu agent không chắc cột nào chứa PII, phải hỏi user trước khi clone, không tự suy đoán "chắc cột này không nhạy cảm".

---

## 2. Migration Testing

### Rollback Test

Chạy `up.sql` → verify schema → chạy `down.sql` → verify rollback.

```bash
# Test migration up + down
# PostgreSQL
psql -d test_db -f 001_add_column.up.sql
# verify column exists
psql -d test_db -c "\d users"
# rollback
psql -d test_db -f 001_add_column.down.sql
# verify column gone
psql -d test_db -c "\d users"

# SQLite
sqlite3 test.db < 001_add_column.up.sql
# verify
sqlite3 test.db ".schema users"
# rollback (SQLite: restore backup)
```

### Integrity Test

Kiểm tra data integrity sau migration:

```sql
-- Test FK không bị broken
SELECT * FROM orders WHERE user_id NOT IN (SELECT id FROM users);

-- Test UNIQUE không bị duplicate
SELECT email, COUNT(*) FROM users GROUP BY email HAVING COUNT(*) > 1;

-- Test CHECK constraint
SELECT * FROM accounts WHERE balance < 0;
```

### Constraint Test

```sql
-- ✅ TEST: insert vi phạm FK → expect error
INSERT INTO orders (id, user_id) VALUES (999, 99999);
-- Lỗi: insert or update on table "orders" violates foreign key constraint

-- ✅ TEST: insert NULL vào NOT NULL column → expect error
INSERT INTO users (id, name) VALUES (999, NULL);
-- Lỗi: null value in column "name" violates not-null constraint

-- ✅ TEST: insert vi phạm CHECK → expect error
INSERT INTO accounts (id, balance) VALUES (999, -100);
-- Lỗi: new row for relation "accounts" violates check constraint
```

### Concurrency Test

```python
# ✅ TEST: 2 transaction đồng thời detect deadlock
# Chạy 2 thread:
# Thread 1: UPDATE A → UPDATE B
# Thread 2: UPDATE B → UPDATE A
# Kết quả: 1 trong 2 bị deadlock → rollback → retry
```

---

## 3. Data Audit

### Phát hiện orphan record

```sql
-- Orders không có user
SELECT * FROM orders
WHERE user_id IS NOT NULL
AND user_id NOT IN (SELECT id FROM users);
```

### Phát hiện duplicate

```sql
-- User trùng email
SELECT email, COUNT(*)
FROM users
GROUP BY email
HAVING COUNT(*) > 1;
```

### Phát hiện impossible values

```sql
-- Balance âm
SELECT * FROM accounts WHERE balance < 0;

-- created_at > updated_at (không hợp lý)
SELECT * FROM users WHERE created_at > updated_at;

-- Future created_at
SELECT * FROM users WHERE created_at > CURRENT_TIMESTAMP;
```

### Reconciliation

So sánh tổng dữ liệu giữa 2 bảng:

```sql
-- Tổng balance accounts phải khớp tổng balance ledger
SELECT
    (SELECT SUM(balance) FROM accounts) AS account_balance,
    (SELECT SUM(amount) FROM ledger) AS ledger_balance;
```

---

## Checklist

- [ ] Seed dùng UPSERT / ON CONFLICT?
- [ ] Seed idempotent?
- [ ] Environment guard trước seed?
- [ ] Migration test: up + down chạy được?
- [ ] Integrity test: FK, UNIQUE, CHECK?
- [ ] Orphan record detected?
- [ ] Impossible values detected?
- [ ] Concurrency test cho critical transaction?

---

## Liên kết

- `20-migration.md` — migration safety, down.sql
- `SKILL.md` — golden rules
- `40-patterns.md` — seed pattern, UPSERT pattern
