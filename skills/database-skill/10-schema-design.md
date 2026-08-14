# 10 Schema Design — Naming, Constraints, Data Types

## 🎯 Trigger

Load khi: tạo bảng mới, thiết kế schema, review kiểu dữ liệu, thêm/ràng buộc cột.

---

## 1. Naming conventions

| Quy tắc | Ví dụ |
|---|---|
| Table: số nhiều, snake_case | `users`, `order_items`, `product_categories` |
| Column: số ít, snake_case | `created_at`, `user_id`, `is_active` |
| Primary key: `id` | `id INTEGER PRIMARY KEY` |
| Foreign key: `{table}_id` | `user_id`, `organization_id`, `category_id` |
| Boolean: bắt đầu verb/adj | `is_active`, `has_paid`, `can_delete`, `is_verified` |
| Index: `idx_{table}_{column}` | `idx_users_email` |
| Unique: `uq_{table}_{column}` | `uq_users_email` |

```sql
-- ❌ SAI: tên viết tắt, không nhất quán
CREATE TABLE emp (eid INT, nm TEXT, dpt INT);

-- ✅ ĐÚNG
CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true
);
```

---

## 2. Constraints

### PRIMARY KEY — mọi bảng phải có

```sql
-- ✅ ĐÚNG
CREATE TABLE users (id INTEGER PRIMARY KEY, ...);

-- ❌ SAI: không PK
CREATE TABLE users (name TEXT, email TEXT);
```

### NOT NULL — mặc định, trừ khi có lý do cho phép NULL

```sql
-- ✅ ĐÚNG: mặc định NOT NULL
email TEXT NOT NULL,
name TEXT NOT NULL,

-- Cho phép NULL khi cố tình
deleted_at TIMESTAMP  -- nullable vì chưa xóa
```

### FOREIGN KEY + ON DELETE

```sql
-- ✅ ĐÚNG
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,

-- ❌ SAI: không FK
user_id INTEGER  -- không ràng buộc → orphan record
```

| ON DELETE | Khi nào dùng |
|---|---|
| `CASCADE` | Child là part-of parent (order_items → orders) |
| `RESTRICT` | Không cho xóa nếu còn child |
| `SET NULL` | Cẩn thận: tạo orphan, ít dùng |
| `NO ACTION` | PostgreSQL: defer check |

### UNIQUE

```sql
-- ✅ ĐÚNG
CREATE TABLE users (
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE
);

-- Unique composite
UNIQUE (year, month, organization_id)
```

### CHECK

```sql
-- ✅ ĐÚNG
CHECK (balance >= 0),
CHECK (status IN ('pending', 'active', 'suspended', 'cancelled')),
CHECK (end_date > start_date),

-- ❌ SAI: không CHECK
status TEXT  -- không ràng buộc → dễ sai data
```

---

## 3. Data Types Matrix

Map requirement → semantic type → dialect type.

| Semantic Type | SQLite | MySQL | PostgreSQL |
|---|---|---|---|
| Boolean | `INTEGER 0/1` | `TINYINT(1)` / `BOOL` | `BOOLEAN` |
| Timestamp (UTC) | `TEXT (ISO8601)` / `INTEGER (unix)` | `DATETIME(6)` hoặc `TIMESTAMP` | `TIMESTAMPTZ` |
| UUID | `TEXT` | `CHAR(36)` hoặc `BINARY(16)` | `UUID` |
| JSON | `TEXT` (JSON functions) | `JSON` | `JSONB` |
| Money | `INTEGER` (cents) | `DECIMAL(19,4)` | `NUMERIC` |
| Auto-increment | `INTEGER PRIMARY KEY` | `INT AUTO_INCREMENT` | `GENERATED AS IDENTITY` |
| Long text | `TEXT` | `TEXT` / `MEDIUMTEXT` | `TEXT` |
| Integer | `INTEGER` | `INT` | `INTEGER` |
| Float (OK cho đo lường) | `REAL` | `FLOAT` / `DOUBLE` | `REAL` / `DOUBLE PRECISION` |

### Luôn ưu tiên UTC cho timestamp

```sql
-- ✅ ĐÚNG: PostgreSQL
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

-- ✅ ĐÚNG: MySQL
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

-- ✅ ĐÚNG: SQLite
created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
```

### Money — CẤM FLOAT/REAL/DOUBLE

```sql
-- ❌ SAI: float cho tiền — mất cent
price FLOAT

-- ✅ ĐÚNG: SQLite
price INTEGER NOT NULL  -- lưu cents

-- ✅ ĐÚNG: MySQL
price DECIMAL(19,4) NOT NULL

-- ✅ ĐÚNG: PostgreSQL
price NUMERIC(19,4) NOT NULL
```

### UUID

```sql
-- PostgreSQL (native)
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

-- MySQL (không native, dùng CHAR)
id CHAR(36) NOT NULL PRIMARY KEY,

-- SQLite
id TEXT NOT NULL PRIMARY KEY
```

---

## 4. Indexing nguyên tắc cơ bản

- `WHERE` / `JOIN` / `ORDER BY` / `GROUP BY` → cần index
- Mỗi bảng nên có 1-3 index, không tạo bừa
- Index tốn write — không index mọi cột
- Composite index: order cột quan trọng (cardinality cao) trước

Xem chi tiết: `21-indexing-query.md`

---

## 5. ORM mapping guide

Khi thiết kế schema, cần tính đến cách ORM ánh xạ:

| ORM | PK mặc định | Timestamp | Money |
|---|---|---|---|
| Prisma | `@id @default(autoincrement())` | `@default(now())` | `@db.Decimal(19, 4)` |
| SQLAlchemy | `Column(Integer, primary_key=True)` | `server_default=func.now()` | `Numeric(19,4)` |
| Django | `AutoField` (tự động) | `auto_now_add=True` | `DecimalField(max_digits=19, decimal_places=4)` |

```prisma
// Prisma example — đúng
model User {
  id         Int      @id @default(autoincrement())
  email      String   @unique
  name       String
  balance    Decimal  @db.Decimal(19, 4)
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")
}
```

---

## 6. Anti-patterns (tuyệt đối tránh)

| Anti-pattern | Vấn đề | Thay thế |
|---|---|---|
| **EAV** (entity-attribute-value) | Query khủng khiếp, không constraint | JSONB (PG) hoặc cột riêng |
| **FLOAT cho money** | Sai số cent | DECIMAL/NUMERIC/INT cents |
| **SELECT \*** | Dư cột, break khi schema đổi | Liệt kê cột cụ thể |
| **Thiếu `created_at` / `updated_at`** | Không trace được | Luôn thêm |
| **Soft delete không partial index** | Query chậm, unique bị lỗi | Partial index `WHERE deleted_at IS NULL` |
| **Không CHECK** | Data sai lặng lẽ | `CHECK (balance >= 0)` |
| **NULL mặc định** | Query phải xử lý null | `NOT NULL` mặc định |

```sql
-- ❌ SAI: EAV
CREATE TABLE user_meta (user_id INT, attr_key TEXT, attr_value TEXT);

-- ✅ ĐÚNG: cột riêng (hoặc JSONB cho PG)
ALTER TABLE users ADD COLUMN preferences JSONB;
```

---

## Checklist

- [ ] PK định?
- [ ] FK + ON DELETE hợp lý?
- [ ] Money dùng DECIMAL/NUMERIC/INT?
- [ ] Timestamp có timezone (TIMESTAMPTZ) / UTC?
- [ ] NOT NULL mặc định?
- [ ] Naming snake_case, số nhiều table?
- [ ] `created_at` + `updated_at`?
- [ ] Index cho WHERE/JOIN?
- [ ] ORM mapping tương thích?

---

## Liên kết

- `21-indexing-query.md` — index chi tiết
- `dialects/*.md` — dialect-specific data types
- `00-safety.md` — kiểm tra môi trường trước DDL
