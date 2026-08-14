# 21 Indexing & Query Performance — EXPLAIN, Cost-Based Decisions, N+1

## 🎯 Trigger

Load khi: tối ưu query chậm, phân tích EXPLAIN, thêm index, phát hiện N+1.

---

## 1. Always / Never

### Always

- Check index cho `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY`
- Đọc `EXPLAIN` trước khi thêm index
- Composite index: column cardinality cao -> thấp

### Never

- ❌ Không tạo index bừa (tốn write, bloat)
- ❌ Index mọi cột — bảng chết vì write
- ❌ `SELECT *` không index covering
- ❌ Không dùng `EXPLAIN` xong vẫn đoán mò

---

## 2. EXPLAIN per DB

```sql
-- PostgreSQL (gold standard)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM users WHERE email = 'test@example.com';

-- MySQL
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';

-- SQLite
EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'test@example.com';
```

---

## 3. Cost-based triggers (đọc EXPLAIN để quyết định)

**Nguyên tắc:** không guess — dùng EXPLAIN cost để quyết định.

### Seq Scan — Scan toàn bộ bảng

```
Seq Scan on users  (cost=0.00..35.00 rows=1000 width=100)
  Filter: (email = 'test@example.com')
```

**Dấu hiệu cần index:**
- Seq Scan trên bảng > 10k rows
- Filter trả về < 5% tổng rows
- Cost cao (> 1000)

```sql
-- ✅ Thêm index
CREATE INDEX idx_users_email ON users (email);
```

### Index Scan — Tốt

```
Index Scan using idx_users_email on users  (cost=0.28..8.29 rows=1 width=100)
  Index Cond: (email = 'test@example.com')
```

### Nested Loop + inner Seq Scan — Thiếu index chắc chắn

```
Nested Loop  (cost=0.00..500.00 rows=100 width=200)
  -> Seq Scan on orders
  -> Seq Scan on order_items  ← ❌ thiếu index trên order_items
```

**Dấu hiệu:** inner scan là Seq Scan → thiếu index trên column JOIN

```sql
-- ✅ Thêm index
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
```

### Hash Join — OK cho table scan

```
Hash Join  (cost=35.00..70.00 rows=100 width=200)
  -> Seq Scan on orders
  -> Hash on order_items
```

### Sort + Temp File — Thiếu memory hoặc index cho ORDER BY

```
Sort  (cost=150.00..200.00 rows=10000 width=100)
  Sort Key: created_at DESC
  -> Seq Scan on users
```

Nếu sort trên column có index → index scan, không cần sort.

---

## 4. Index types

### B-tree (default)

```sql
CREATE INDEX idx_users_email ON users (email);
-- WHERE, =, >, <, BETWEEN, LIKE 'prefix%'
```

### Composite

```sql
-- Order quan trọng: column cardinality cao -> thấp
CREATE INDEX idx_users_status_created_at ON users (status, created_at);

-- WHERE status = 'active' AND created_at > '2024-01-01'
-- status first (lọc nhanh), created_at second (range)
```

### Partial

```sql
-- Chỉ index row có điều kiện — tiết kiệm không gian
-- PostgreSQL, SQLite support; MySQL không support
CREATE INDEX idx_users_active ON users (email) WHERE is_active = true;
```

### Covering

```sql
-- Index chứa cả data, không cần đọc table
-- PostgreSQL: INCLUDE (MySQL 8.0.13+)
CREATE INDEX idx_users_email ON users (email) INCLUDE (name, avatar_url);
-- Query SELECT email, name, avatar_url chỉ đọc index
```

### Expression

```sql
-- PostgreSQL, SQLite
CREATE INDEX idx_users_lower_email ON users (LOWER(email));
-- WHERE LOWER(email) = 'test@example.com' → dùng được index
```

---

## 5. N+1 Detection

N+1: 1 query lấy danh sách + N query lấy detail từng item.

```python
# ❌ SAI: N+1
orders = session.query(Order).all()  # 1 query
for order in orders:
    print(order.user.name)  # N query → mỗi order 1 query user

# ✅ ĐÚNG: eager loading
orders = session.query(Order).options(joinedload(Order.user)).all()
```

**Dấu hiệu phát hiện:**
- Vòng lặp gọi query trong code
- ORM có lazy loading = True
- N+1 khi render API response

**Cách fix:**
- Eager loading: `JOIN` / `INNER JOIN`
- Batch: `IN (ids)` thay vì từng record
- Pagination: `LIMIT` + `OFFSET` / cursor pagination

---

## 6. Anti-patterns

| Anti-pattern | Hậu quả | Fix |
|---|---|---|
| Index mọi cột | Write chậm, disk bloat | Chỉ index column dùng trong WHERE/JOIN/ORDER |
| `SELECT *` | Không dùng được covering index | Chỉ select cột cần |
| LIKE '%pattern' | Không dùng index được | Full text search (trigram index PG) |
| JOIN không index | Seq Scan, Nested Loop | Index trên FK column |
| N+1 ORM | Hàng trăm query nhỏ | Eager loading, batch |
| Index column không selective | Index không hiệu quả | index trên column high-cardinality |

```sql
-- ❌ SAI: LIKE '%...' không dùng index
SELECT * FROM users WHERE bio LIKE '%keyword%';

-- ✅ ĐÚNG: PostgreSQL trigram index
CREATE INDEX idx_users_bio_trgm ON users USING gin (bio gin_trgm_ops);
SELECT * FROM users WHERE bio ILIKE '%keyword%';
```

---

## Checklist

- [ ] Đã chạy `EXPLAIN`?
- [ ] Có Seq Scan trên bảng lớn > 10k rows?
- [ ] Có Nested Loop + inner Seq Scan (thiếu index JOIN)?
- [ ] N+1 trong ORM code?
- [ ] Composite index order đúng (cardinality)?
- [ ] Partial index cho active rows?
- [ ] `SELECT *` có thể tối ưu?
- [ ] Index không quá nhiều (max 3-5 / bảng)?

---

## Liên kết

- `10-schema-design.md` — index cơ bản
- `40-patterns.md` — cursor pagination, eager loading
- `dialects/*.md` — index syntax per DB
