# 40 Patterns — Decision Trees, Design Patterns, Error Recovery

## 🎯 Trigger

Load khi: cần pattern phổ biến (pagination, soft delete, UPSERT, bulk insert, outbox), hoặc gặp lỗi (deadlock, SQLITE_BUSY, migration fail).

---

## 1. Decision Trees

### Need JSON storage?

```
Need JSON?
├── One DB, simple query → JSON column (MySQL JSON / PG JSONB)
├── SQLite → TEXT (JSON functions)
├── MySQL → JSON
└── PostgreSQL → JSONB + GIN index (luôn)
```

### Need pagination?

```
Need pagination?
├── Table < 10k rows, offset OK
│   └── SELECT * FROM table LIMIT 20 OFFSET 0
├── Table > 10k rows, realtime
│   └── Cursor pagination: WHERE id > last_seen ORDER BY id LIMIT 20
├── Need stable sort across pages
│   └── Keyset: WHERE (created_at, id) > (last_ts, last_id) ORDER BY created_at, id
└── Search + sort arbitrary columns
    └── ElasticSearch / MeiliSearch (DB pagination không đủ)
```

### Need lock?

```
Need lock?
├── SQLite (single-writer)
│   └── BEGIN IMMEDIATE + busy_timeout
├── Concurrent write, same row (PG/MySQL)
│   ├── Want retry on conflict → Optimistic lock (version column)
│   └── Want wait → SELECT FOR UPDATE
├── Queue consumer (multiple workers)
│   └── SELECT ... LIMIT 1 FOR UPDATE SKIP LOCKED
└── Application-level mutex (cross-row)
    └── PG: pg_advisory_lock / MySQL: GET_LOCK()
```

### Need migration?

```
Need migration?
├── SQLite
│   └── CREATE new → INSERT → DROP old → RENAME
├── MySQL
│   └── ALTER ... ALGORITHM=INPLACE, LOCK=NONE
├── PostgreSQL
│   ├── DDL trong transaction (rollback được)
│   └── CREATE INDEX CONCURRENTLY ngoài transaction
└── Data > 100k rows
    └── Batch migrate 1000 rows / batch + checkpoint
```

---

## 2. Common SQL Patterns

### Pagination

```sql
-- OFFSET (table nhỏ)
SELECT id, name FROM users ORDER BY id LIMIT 20 OFFSET 40;

-- Cursor (table lớn, realtime)
SELECT id, name FROM users WHERE id > 40 ORDER BY id LIMIT 20;

-- Keyset (composite)
SELECT id, name, created_at FROM users
WHERE (created_at, id) > ('2024-06-01', 100)
ORDER BY created_at, id LIMIT 20;
```

### Soft Delete

```sql
-- Schema
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP;

-- Query (luôn filter)
SELECT * FROM users WHERE deleted_at IS NULL;

-- PostgreSQL: partial index (cần cho UNIQUE và WHERE)
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE deleted_at IS NULL;

-- SQLite: partial index support
CREATE UNIQUE INDEX uq_users_email_active ON users (email) WHERE deleted_at IS NULL;
```

### UPSERT

```sql
-- PostgreSQL
INSERT INTO users (id, email, name)
VALUES (1, 'a@b.com', 'A')
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name;

-- SQLite
INSERT INTO users (id, email, name)
VALUES (1, 'a@b.com', 'A')
ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    name = excluded.name;

-- MySQL
INSERT INTO users (id, email, name)
VALUES (1, 'a@b.com', 'A')
ON DUPLICATE KEY UPDATE
    email = VALUES(email),
    name = VALUES(name);
```

### Bulk Insert

```sql
-- Batching 500-1000 rows / transaction
BEGIN;
INSERT INTO logs (user_id, action, created_at) VALUES
    (1, 'login', '2024-01-01'),
    (2, 'login', '2024-01-01'),
    ...  -- max 1000 rows
    (500, 'logout', '2024-01-01');
COMMIT;
```

### Outbox Pattern

```sql
-- 1 transaction: insert + publish
BEGIN;
INSERT INTO orders (id, user_id, total_cents) VALUES (1, 1, 5000);
INSERT INTO outbox (event_type, payload, created_at)
VALUES ('order.created', '{"order_id": 1}', NOW());
COMMIT;

-- Worker đọc outbox → publish event → delete
```

### Optimistic Lock

```sql
-- Schema: thêm version column
ALTER TABLE accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Update có check version
UPDATE accounts
SET balance = balance - 100, version = version + 1
WHERE id = 1 AND version = :current_version;

-- Nếu row affected = 0 → conflict → retry
```

### Tree / Hierarchy (PostgreSQL)

```sql
-- Recursive CTE cho tree
WITH RECURSIVE org_tree AS (
    SELECT id, name, parent_id, 1 AS depth
    FROM organizations WHERE id = 1
    UNION ALL
    SELECT o.id, o.name, o.parent_id, t.depth + 1
    FROM organizations o
    JOIN org_tree t ON o.parent_id = t.id
)
SELECT * FROM org_tree;
```

### Tenant Isolation

```sql
-- Row-level isolation
-- PostgreSQL: RLS
CREATE POLICY tenant_isolation ON accounts
USING (tenant_id = current_setting('app.current_tenant_id')::INT);

-- MySQL: WHERE tenant_id = ? (application layer)
SELECT * FROM accounts WHERE tenant_id = ?;

-- SQLite: WHERE tenant_id = ? (application layer)
SELECT * FROM accounts WHERE tenant_id = ?;
```

---

## 3. Error Recovery Patterns

### Migration Failure

```
Migration fail giữa chừng
├── Có transaction (PG) → ROLLBACK, sửa lỗi, chạy lại
├── MySQL → phải repair manual (implicit commit)
│   └── Check state hiện tại → apply phần còn thiếu
├── SQLite → restore từ backup
│   └── cp database.db.backup database.db
└── Data bị inconsistent → repair script
    └── UPDATE / DELETE để đồng bộ dữ liệu
```

### Database Locked

```
Database locked / busy
├── SQLite
│   ├── busy_timeout = 5000
│   ├── WAL mode
│   ├── BEGIN IMMEDIATE thay vì DEFERRED
│   └── Retry 3 lần
├── MySQL
│   ├── innodb_lock_wait_timeout = 5
│   └── Check SHOW PROCESSLIST; kill blocking query
└── PostgreSQL
    ├── lock_timeout = 5s
    ├── SELECT FOR UPDATE NOWAIT (fail nhanh)
    └── pg_cancel_backend(pid) cho blocking query
```

### Deadlock

Lỗi deadlock → retry transaction:

```python
MAX_RETRIES = 3
for attempt in range(MAX_RETRIES):
    try:
        BEGIN
        -- operations
        COMMIT
        break
    except (DeadlockError, SerializationError):
        ROLLBACK
        if attempt == MAX_RETRIES - 1:
            raise
        sleep(exponential_backoff(attempt))
```

### Connection Lost

```
Connection lost giữa chừng
├── Check connection pool (auto-reconnect)
├── Retry transaction từ đầu
└── Nếu persistent fail → alert human
```

### Data Corruption

```
Data corruption detect
├── SQLite: PRAGMA integrity_check;
├── PostgreSQL: pg_checksums
├── MySQL: CHECK TABLE table_name
└── Fix: restore từ backup
```

---

## 4. Anti-pattern Decision Tree

```
Want to store money?
├── Dùng FLOAT/REAL/DOUBLE? → ❌ CẤM. Sai số cent
└── Dùng INTEGER cents (SQLite) / DECIMAL (MySQL) / NUMERIC (PG)

Want to delete?
├── Dữ liệu cần giữ? → Soft delete (deleted_at)
└── Xóa thật → CASCADE depth < 3

Want to create table?
├── Thiết kế xong chưa? → Review: PK, FK, constraints, naming
└── OK → CHECK đồng ý → CREATE TABLE

Want to add index?
├── Đã chạy EXPLAIN? → chưa → chạy EXPLAIN trước
└── OK → CREATE INDEX ... (partial nếu WHERE filter)
```

---

## Liên kết

- `11-transactions.md` — transaction cơ bản
- `12-concurrency.md` — lock, deadlock
- `20-migration.md` — migration safety
- `21-indexing-query.md` — index strategy
- `31-testing-seed.md` — testing, seed
