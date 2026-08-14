---
name: architecture
description: Định nghĩa kiến trúc Flutter cố định (state management, router, cấu trúc thư mục Feature-First) mà mọi code sinh ra phải tuân theo. Dùng skill này mỗi khi sinh code mới, tạo feature mới, hoặc khi cần quyết định đặt file ở đâu trong project Flutter.
---

# Architecture (Blueprint cố định)

Đây là bộ rule KHÓA CỨNG. Agent không được tự ý đổi state management, router, hay cấu trúc thư mục giữa các lần chạy, kể cả khi thấy "cách khác hay hơn".

## Stack đã chọn (không thương lượng lại trong project đang chạy)

- **State management:** Riverpod (dùng codegen: `@riverpod`)
- **Router:** GoRouter
- **Cấu trúc:** Feature-First

Nếu project đã tồn tại và dùng stack khác, GIỮ NGUYÊN stack cũ của project, không refactor sang Riverpod/GoRouter giữa chừng trừ khi user yêu cầu rõ ràng.

## Cấu trúc thư mục chuẩn

```
lib/
├── app/
│   ├── router/           # GoRouter config, route names
│   └── theme/             # ThemeData, lấy từ design-system
├── core/
│   ├── constants/
│   ├── extensions/
│   └── utils/
├── shared/
│   ├── widgets/            # widget dùng chung (xem widget-library trong flutter-coding)
│   └── services/            # API client, local storage wrapper
└── feature/
    └── <ten_feature>/
        ├── data/            # models, repository implementation
        ├── domain/          # entity, repository interface (nếu cần tách)
        ├── application/     # providers (riverpod)
        └── presentation/
            ├── screens/
            └── widgets/
```

Mỗi feature mới (ví dụ `order`, `auth`, `profile`) PHẢI theo đúng khuôn này. Không tạo cấu trúc riêng cho từng feature.

## Quy tắc package (khớp với Ponytail exclusion)

- Không tự ý thêm package mới vào `pubspec.yaml` ngoài danh sách đã duyệt: `flutter_riverpod`, `riverpod_annotation`, `go_router`, `dio` (hoặc backend SDK tương ứng), `freezed`/`json_serializable` nếu cần model codegen, `supabase_flutter` (nếu backend là Supabase - xem `backend-coding/SKILL.md`).
- Nếu tính năng thực sự cần package mới không có trong danh sách → DỪNG, hỏi user xác nhận trước khi thêm, không tự thêm rồi báo sau.
- `pubspec.yaml` nên nằm trong vùng Ponytail exclusion - nếu agent thấy bị chặn sửa file này, đó là chủ đích, không phải lỗi.

## Naming convention

- File: `snake_case.dart`
- Class: `PascalCase`
- Provider: `<tenNoun>Provider` (ví dụ `cartProvider`, `orderListProvider`)
- Route path: `/kebab-case`, route name: `camelCase`

## Khi nào KHÔNG áp dụng skill này

- Khi đang sửa lỗi nhỏ (typo, style) không liên quan đến vị trí file hay kiến trúc — không cần load lại skill này, xử lý trực tiếp trong `flutter-coding`.
