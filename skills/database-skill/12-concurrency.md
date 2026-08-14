# 12 Concurrency — Locking, Deadlock, Retry

## 🎯 Trigger

Load khi: viết transaction có concurrent write (chuyển tiền, cập nhật hàng tồn kho), xử lý queue/consumer, hoặc khi cần `SELECT FOR UPDATE`.

---

## 1. Three common concurrency problems

### Lost Update

User A đọc balance = 100. User B đọc balance = 100.
User A ghi balance = 90. User B ghi balance = 80 (overwrite A).

```python
# ❌ SAI: lost update
balance = cursor.execute("SELECT balance FROM accounts WHERE id = 1").fetchone()[0]
new_balance = balance - 10
cursor.execute("UPDATE accounts SET balance = ? WHERE id = 1", (new_balance,))
# Nếu 2 requests chạy đồng thời, 1 cập nhật bị mất
```

### Dirty Read

Đọc dữ liệu chưa COMMIT — dữ liệu có thể rollback.

### Phantom Read

Transaction A đọc danh sách. Transaction B INSERT hàng mới. A đọc lại thấy hàng mới xuất hiện (phantom).

---

## 2. Giải pháp

### Optimistic Lock — dùng version column

```sql
-- Schema
ALTER TABLE accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Update
UPDATE accounts
SET balance = balance - 100, version = version + 1
WHERE id = 1 AND version = :current_version;

-- Kiểm tra: nếu row affected = 0, có conflict → retry
```

```python
# ✅ ĐÚNG: optimistic lock
current_version = 1
while True:
    row = cursor.execute("SELECT balance, version FROM accounts WHERE id = 1").fetchone()
    balance, version = row
    new_balance = balance - 100
    cursor.execute("UPDATE accounts SET balance = ?, version = version + 1 WHERE id = 1 AND version = ?", (new_balance, version))
    if cursor.rowcount > 0:
        break
    # conflict → retry với version mới
```

### Pessimistic Lock — SELECT FOR UPDATE

```sql
-- ✅ ĐÚNG: MySQL/PostgreSQL
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- account 1 bị lock, transaction khác chờ
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;
```

```sql
-- ✅ ĐÚNG: với SKIP LOCKED (queue consumer)
BEGIN;
SELECT id, payload FROM job_queue
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;
-- skip hàng đang bị transaction khác lock
COMMIT;
```

### SQLite — single-writer

SQLite không cần `FOR UPDATE` — write serialize sẵn. Dùng `BEGIN IMMEDIATE`:

```sql
BEGIN IMMEDIATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

---

## 3. Deadlock và Retry Loop

### Deadlock là gì

Transaction A lock row 1 → chờ row 2.
Transaction B lock row 2 → chờ row 1.
Cả 2 không ai tiến được → database kill 1 transaction.

### Phòng tránh deadlock

- Luôn lock row theo **cùng thứ tự** (A → B, không B → A)
- Giữ transaction ngắn
- Có timeout

### Deadlock Retry Loop — pattern bắt buộc

```python
# ✅ ĐÚNG: retry khi deadlock
import time
import random

MAX_RETRIES = 3

for attempt in range(MAX_RETRIES):
    try:
        cursor.execute("BEGIN")
        cursor.execute("UPDATE accounts SET balance = balance - 100 WHERE id = 1")
        cursor.execute("UPDATE accounts SET balance = balance + 100 WHERE id = 2")
        cursor.execute("COMMIT")
        break  # thành công
    except (DeadlockError, SerializationError):
        cursor.execute("ROLLBACK")
        if attempt == MAX_RETRIES - 1:
            raise  # retry hết lần, vẫn lỗi
        wait_time = (2 ** attempt) + random.uniform(0, 1)  # exponential backoff
        time.sleep(wait_time)
    except Exception:
        cursor.execute("ROLLBACK")
        raise  # lỗi khác, không retry
```

### Transient (retryable) vs Permanent (không được retry) per DB

Agent hay retry mù — kể cả lỗi cú pháp hay vi phạm constraint — vì thấy "lỗi thì retry cho chắc". Phải phân biệt rõ theo mã lỗi/SQL state, không đoán từ message text:

| DB | Retryable (transient) | Không được retry (permanent) |
|---|---|---|
| SQLite | `SQLITE_BUSY` (5), `SQLITE_LOCKED` (6) | Constraint violation, syntax error, FK violation |
| PostgreSQL | `40P01` (deadlock_detected), `40001` (serialization_failure) | `23505` (unique_violation), `23503` (FK violation), syntax error |
| MySQL InnoDB | `1213` (ER_LOCK_DEADLOCK), `1205` (lock wait timeout exceeded) | `1062` (duplicate key), FK violation, syntax error |

Với lỗi permanent: `ROLLBACK` ngay, báo lỗi cho user, **cấm retry** — retry sẽ chỉ lặp lại đúng lỗi đó (hoặc tệ hơn, che giấu bug thật).

---

## 4. DB-specific lock mechanism

### PostgreSQL

```sql
-- FOR UPDATE (row lock, chờ)
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;

-- FOR UPDATE SKIP LOCKED (không chờ, chỉ lock row available)
SELECT * FROM job_queue ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED;

-- FOR UPDATE NOWAIT (fail ngay nếu conflict)
SELECT * FROM accounts WHERE id = 1 FOR UPDATE NOWAIT;

-- Advisory Lock (application-level mutex)
SELECT pg_advisory_lock(100);     -- lock id 100
SELECT pg_advisory_unlock(100);   -- unlock
```

### MySQL

```sql
-- InnoDB mặc định row-level lock
-- FOR UPDATE (chờ)
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;

-- SKIP LOCKED (MySQL 8.0+)
SELECT * FROM job_queue ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED;

-- NOWAIT (MySQL 8.0+)
SELECT * FROM accounts WHERE id = 1 FOR UPDATE NOWAIT;

-- Advisory Lock
SELECT GET_LOCK('lock_name', 10);  -- timeout 10s
SELECT RELEASE_LOCK('lock_name');
```

### SQLite

```sql
-- SQLite single-writer, không cần FOR UPDATE
-- Dùng BEGIN IMMEDIATE để lock ngay
BEGIN IMMEDIATE;
-- các lệnh ghi
COMMIT;

-- busy_timeout: thay vì retry loop
PRAGMA busy_timeout = 5000;  -- đợi 5s nếu DB busy
```

---

## Checklist

- [ ] Lost update có optimistic/pessimistic lock?
- [ ] Có Deadlock Retry Loop (3 lần + exponential backoff)?
- [ ] FOR UPDATE SKIP LOCKED? Nếu dùng queue worker, có `FOR UPDATE SKIP LOCKED`?
- [ ] SQLite dùng `BEGIN IMMEDIATE`?
- [ ] Lock order consistent giữa các transaction?
- [ ] Transaction ngắn (không giữ lock lâu)?

---

## Liên kết

- `11-transactions.md` — transaction cơ bản, isolation
- `40-patterns.md` — optimistic lock pattern, queue pattern
- `dialects/*.md` — DB-specific lock behavior
