# 30 Review — Database Code Review Checklist

## 🎯 Trigger

Load khi: review code SQL/ORM, audit database chất lượng, peer review migration.

---

## 1. SQL Checklist

### Transaction & Rollback

- [ ] `UPDATE` / `DELETE` / `INSERT` có transaction?
- [ ] Có `ROLLBACK` khi lỗi?
- [ ] Transaction quá dài (> 1s)?
- [ ] SQLite dùng `BEGIN IMMEDIATE`?

### Foreign Key

- [ ] FK khai báo?
- [ ] `ON DELETE` hợp lý? (`CASCADE` không gây mất dữ liệu?)
- [ ] `SET NULL` không gây orphan?
- [ ] CASCADE depth > 3? (nguy cơ xóa cả database)

### Index

- [ ] Index cho `WHERE` / `JOIN` / `ORDER BY`?
- [ ] Composite index order đúng?
- [ ] Index không dư thừa? (ví dụ: đã có `(a, b)` lại tạo `(a)`)
- [ ] Partial index cho query chỉ xử lý active records?

### SQL Injection

- [ ] Dùng parameterized query? (`?`, `$1`, `%s` bị SQL injection)
- [ ] `LIKE` có escape?
- [ ] ORDER BY column có validate? (dynamic ORDER BY dễ injection)

### SELECT

- [ ] `SELECT *`? → liệt kê cột
- [ ] `LIMIT` đủ? (nếu không có WHERE, mặc định LIMIT 100)
- [ ] `DISTINCT` thực sự cần? (hay dùng EXISTS)
- [ ] JOIN có đúng loại? (INNER vs LEFT)

### NULL

- [ ] `NOT NULL` cho column bắt buộc?
- [ ] So sánh NULL đúng? (`IS NULL` / `IS NOT NULL`, không `= NULL`)
- [ ] COALESCE cho giá trị có thể null?

### Migration

- [ ] `down.sql` sẵn sàng?
- [ ] Idempotent (`IF NOT EXISTS` / `IF EXISTS`)?
- [ ] Backward compatible?
- [ ] Backup đã chạy?

---

## 2. ORM Checklist

### N+1

- [ ] Có vòng lặp gọi query (lazy loading trong loop)?
- [ ] Có eager loading (`JOIN` / `IN` / batch)?
- [ ] API response có gây N+1 qua serializer?

```python
# ❌ SAI: N+1
users = User.query.all()
for user in users:
    print(user.orders)  # mỗi user 1 query orders

# ✅ ĐÚNG: eager loading
users = User.query.options(joinedload(User.orders)).all()
```

### Transaction Boundary

- [ ] Mỗi `save()` trong loop tạo transaction riêng?
- [ ] Có context manager / decorator cho transaction?

```python
# ❌ SAI: mỗi iteration 1 transaction
for item in items:
    db.session.add(item)
    db.session.commit()

# ✅ ĐÚNG: một transaction
with db.session.begin():
    for item in items:
        db.session.add(item)
```

### Connection Management

- [ ] Connection được close (finally / context manager)?
- [ ] Pool size phù hợp?
- [ ] Serverless: connection timeout ngắn?

### Type Mapping

- [ ] Money type mapping đúng? (ORM Decimal → DB DECIMAL/NUMERIC)
- [ ] Boolean mapping đúng? (ORM boolean → SQLite INTEGER 0/1)
- [ ] Enum mapping đúng? (ORM enum → DB CHECK/VARCHAR)

---

## 3. Data Risk Checklist

### Money & Balance

- [ ] Money column dùng FLOAT/REAL/DOUBLE? → **CẤM**
- [ ] Balance update có transaction?
- [ ] Balance update có lock?
- [ ] Subtract balance có kiểm tra số dư?

### Cascade

- [ ] Cascade DELETE có gây mất dữ liệu liên quan?
- [ ] Cascade depth > 3?
- [ ] `ON DELETE SET NULL` có tạo orphan?

### Data Loss

- [ ] `DELETE` không `WHERE`?
- [ ] `DROP TABLE` / `TRUNCATE` có backup?
- [ ] `UPDATE` không `WHERE`?
- [ ] Migration có rollback plan?

---

## 4. Query Performance Review

- [ ] `EXPLAIN` output đã kiểm tra?
- [ ] Seq Scan trên bảng > 10k rows?
- [ ] Nested Loop + inner scan thiếu index?
- [ ] Sort dùng index chưa?
- [ ] Bulk insert batch 500-1000 rows?

---

## 5. Visual Review Pattern

Khi review, đọc code theo thứ tự:

1. **SELECT đầu tiên:** có `LIMIT`? có `WHERE`? có index?
2. **Transaction:** BEGIN ở đâu? COMMIT đâu? ROLLBACK khi lỗi?
3. **Constraint:** FK, uniq, check? naming đúng?
4. **Migration:** có down.sql? idempotent? backup?
5. **ORM loop:** có N+1? transaction boundary đúng?

---

## 6. Evidence-based Review (bắt buộc)

Mọi nhận xét trong review **phải** đi kèm bằng chứng cụ thể, không được phán đoán mơ hồ kiểu "có vẻ chậm" hay "nên thêm index cho chắc".

Mỗi finding phải nêu đủ 3 phần:

1. **Vị trí**: tên file + số dòng (hoặc tên bảng/cột cụ thể).
2. **Rule vi phạm**: trỏ đúng Golden Rule (`SKILL.md`) hoặc mục checklist bị vi phạm (ví dụ "SQL Checklist → Index").
3. **Bằng chứng**: output `EXPLAIN` thật (nếu là performance), hoặc kiểu dữ liệu xung đột / constraint thiếu đọc được từ schema thật (nếu là schema) — không suy diễn từ tên cột.

```text
❌ SAI (mơ hồ): "Query này có vẻ chậm, nên thêm index."

✅ ĐÚNG (có bằng chứng):
File: orders.sql, dòng 42
Vi phạm: SQL Checklist → Index (thiếu index cho WHERE)
Bằng chứng: EXPLAIN cho thấy `Seq Scan on orders (cost=0.00..8450.00 rows=1 width=64)`
trên bảng 120k rows, filter status='pending' chỉ khớp ~3% → cần index
(status) hoặc partial index WHERE status='pending'.
```

Nếu không lấy được bằng chứng thật (không có quyền chạy EXPLAIN, không đọc được schema), phải nói rõ "chưa xác minh được, cần chạy EXPLAIN trước khi kết luận" thay vì đưa ra khuyến nghị chắc nịch.

---

## Liên kết

- `11-transactions.md` — transaction, rollback
- `20-migration.md` — migration safety
- `21-indexing-query.md` — index review
- `10-schema-design.md` — schema review
- `00-safety.md` — environment guard
