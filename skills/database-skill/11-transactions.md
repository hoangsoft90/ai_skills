# 11 Transactions — BEGIN, COMMIT, ROLLBACK

## 🎯 Trigger

Load khi: viết logic ghi dữ liệu (INSERT/UPDATE/DELETE), xử lý chuyển tiền, đặt hàng, hoặc bất kỳ thao tác nào cần atomicity.

---

## 1. Always / Never

### Always

```sql
BEGIN;
-- operations
COMMIT;
```

### Never

- ❌ UPDATE không transaction
- ❌ Không ROLLBACK khi lỗi
- ❌ Để transaction mở (chờ user input)
- ❌ Transaction quá lâu (giữ lock hàng giờ)

---

## 2. Cấu trúc transaction đúng

### Sai — dễ bị partial update

```python
# ❌ SAI: UPDATE không transaction
cursor.execute("UPDATE accounts SET balance = balance - 100 WHERE id = 1")
cursor.execute("UPDATE accounts SET balance = balance + 100 WHERE id = 2")
# Nếu lệnh 2 fail, account 1 mất 100
```

### Đúng — có BEGIN/COMMIT/ROLLBACK

```python
# ✅ ĐÚNG
try:
    cursor.execute("BEGIN")
    cursor.execute("UPDATE accounts SET balance = balance - 100 WHERE id = 1")
    cursor.execute("UPDATE accounts SET balance = balance + 100 WHERE id = 2")
    cursor.execute("COMMIT")
except Exception:
    cursor.execute("ROLLBACK")
    raise
```

### Python context manager pattern

```python
# ✅ ĐÚNG: context manager (connection tự động begin/commit/rollback)
with connection:
    cursor.execute("UPDATE accounts SET balance = balance - 100 WHERE id = 1")
    cursor.execute("UPDATE accounts SET balance = balance + 100 WHERE id = 2")
# context manager tự động COMMIT nếu không lỗi, ROLLBACK nếu có lỗi
```

---

## 3. Isolation levels

| Level | Dirty Read | Lost Update | Phantom Read | Dùng khi |
|---|---|---|---|---|
| READ UNCOMMITTED | ✔ (xảy ra) | ✔ | ✔ | Rất hiếm, MySQL InnoDB default = REPEATABLE READ |
| READ COMMITTED | ✘ | ✔ | ✔ | **Mặc định PostgreSQL**, đa số use case |
| REPEATABLE READ | ✘ | ✘ | ✔ | Mặc định MySQL InnoDB |
| SERIALIZABLE | ✘ | ✘ | ✘ | Chạy chậm, dùng khi tuyệt đối chính xác |

### PostgreSQL: READ COMMITTED default

```sql
BEGIN;
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- operations
COMMIT;
```

### MySQL: REPEATABLE READ default

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
BEGIN;
-- operations
COMMIT;
```

**Khuyến nghị:** Dùng default isolation (READ COMMITTED cho PG, REPEATABLE READ cho MySQL). Chỉ tăng SERIALIZABLE khi thực sự cần (ví dụ: kiểm tra balance rồi ghi nợ).

---

## 4. Transaction timeout

```sql
-- PostgreSQL: transaction timeout
SET idle_in_transaction_session_timeout = '30s';

-- MySQL: lock wait timeout
SET innodb_lock_wait_timeout = 5;  -- seconds
```

- Không để transaction mở quá lâu
- Transaction dài → giữ lock → ảnh hưởng concurrent

---

## 5. DB-specific transaction behavior

### SQLite

```sql
-- BẮT BUỘC dùng BEGIN IMMEDIATE
BEGIN IMMEDIATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

- `BEGIN` (DEFERRED) mặc định — chờ đến khi write mới acquire lock → dễ `SQLITE_BUSY`
- `BEGIN IMMEDIATE` acquire lock ngay → an toàn hơn
- SQLite không support concurrent write — single-writer

### MySQL

```sql
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

- DDL (`ALTER`, `CREATE`, `DROP`) gây **implicit COMMIT** — transaction trước đó bị commit ngay
- `START TRANSACTION` tương đương `BEGIN`
- InnoDB mặc định REPEATABLE READ — row-level locking

### PostgreSQL

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

- DDL **rollback được** — lợi thế lớn so với MySQL
- `BEGIN` / `COMMIT` / `ROLLBACK`
- Mặc định READ COMMITTED

---

## 6. ORM transaction boundary

### Prisma

```typescript
// ✅ ĐÚNG: interactive transaction
await prisma.$transaction(async (tx) => {
    await tx.account.update({ where: { id: 1 }, data: { balance: { decrement: 100 } } });
    await tx.account.update({ where: { id: 2 }, data: { balance: { increment: 100 } } });
});
```

### SQLAlchemy

```python
# ✅ ĐÚNG: context manager
with Session() as session:
    session.add(account1)
    session.add(account2)
    session.commit()
```

### Django

```python
# ✅ ĐÚNG
from django.db import transaction

with transaction.atomic():
    account1.balance -= 100
    account1.save()
    account2.balance += 100
    account2.save()
```

### Cảnh báo ORM

- Mỗi `save()` trong loop tạo transaction riêng — dùng bulk hoặc bọc trong `atomic`
- Lazy loading trong loop = N+1, cũng tạo nhiều transaction nhỏ

---

## Checklist

- [ ] Có `BEGIN` và `COMMIT`?
- [ ] Có `ROLLBACK` khi lỗi (try/except)?
- [ ] Transaction có timeout?
- [ ] SQLite dùng `BEGIN IMMEDIATE`?
- [ ] MySQL DDL không nằm trong transaction?
- [ ] ORM transaction boundary đúng?
- [ ] Không để transaction mở?
- [ ] Isolation level phù hợp?

---

## Liên kết

- `12-concurrency.md` — lock, deadlock retry
- `40-patterns.md` — optimistic lock pattern
- `dialects/*.md` — DB-specific behavior
