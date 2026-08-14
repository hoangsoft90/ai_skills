---
name: flutter-tab-auth-debug
description: Debug Flutter bottom tab stuck-loading, auth redirect loops, and reload/route restoration bugs in Riverpod + GoRouter apps. Use when tabs show infinite spinner, wrong tab after reload, or splash screen ignores current route.
---

# Flutter Tab Auth Debug

## Core problem

Flutter + Riverpod + GoRouter bottom tab app có thể bị stuck loading hoặc redirect sai sau reload. Nguyên nhân thường là **auth status transition race + redirect logic hardcode** gây mất tab context.

## 1. Khi nào áp dụng

- Bottom tab stuck at loading spinner, especially Account tab
- SplashScreen redirect về wrong tab sau reload
- Reload page ở `/account` thì quay về `/attendance`
- `session == null` hiển thị loading vô hạn dù đã login
- App treo ở SplashScreen vì `checkAuth()` không resolve

## 2. Quy trình debug

Bước 1: Reproduce → mở DevTools console/log, xem `Splash auth status changed` log có in ra không, authStatus qua các state nào: `unknown → authenticated → ?`

Bước 2: Nếu authStatus mãi là `unknown` → `checkAuth()` treo. Thêm timeout cho `verifySession()` (10s).

Bước 3: Nếu authStatus sang `authenticated` nhưng tab vẫn sai → SplashScreen hardcode redirect sang `/attendance`. Phải giữ route hiện tại.

Bước 4: Nếu reload ở tab Profile mà stuck loading → check `app.dart` redirect logic: `authStatus == unknown` có trả `null` không. Nếu trả `null`, GoRouter load route trực tiếp trước khi auth resolve → AccountScreen thấy `session == null` → stuck.

## 3. Pattern đúng

### Pattern A: checkAuth() có timeout

```dart
Future<void> checkAuth() async {
  // ... read token, baseUrl ...

  try {
    final result = await client
        .verifySession(token)
        .timeout(const Duration(seconds: 10));

    if (result != null) {
      final sessionData = result['session'] as Map<String, dynamic>?;
      if (sessionData != null) {
        final session = Session.fromJson(sessionData);
        ref.read(sessionProvider.notifier).set(session);
        state = AuthStatus.authenticated;
        return;
      }
    }
  } on TimeoutException {
    // server treo → coi unauthenticated
  } catch (_) {}

  state = AuthStatus.unauthenticated;
}
```

### Pattern B: SplashScreen giữ route hiện tại

```dart
ref.listen<AuthStatus>(authStatusProvider, (previous, next) {
  if (!mounted) return;
  if (next == AuthStatus.authenticated) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        final location = GoRouter.of(context).state.matchedLocation;
        if (location == '/' || location == '/login') {
          context.go('/attendance');
        }
        // Otherwise stay on current route
      }
    });
  } else if (next == AuthStatus.unauthenticated) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.go('/login');
    });
  }
});
```

### Pattern C: app.dart redirect về / khi unknown

```dart
redirect: (context, state) {
  final authStatus = ref.read(authStatusProvider);

  if (authStatus == AuthStatus.unknown) {
    final path = state.matchedLocation;
    if (path == '/' || path == '/login') return null;
    return '/';
  }

  // ... authenticated / unauthenticated branches
}
```

### Pattern D: AccountScreen handle session == null

```dart
if (session == null) {
  final authStatus = ref.watch(authStatusProvider);

  if (authStatus == AuthStatus.unauthenticated) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.go('/login');
    });
    return Scaffold(body: Center(child: Text('Phiên hết hạn')));
  }

  return const Scaffold(body: Center(child: CircularProgressIndicator()));
}
```

## 4. Luồng xử lý sau fix

```
Reload page at /account
  ├─ app.dart: authStatus == unknown → redirect → /
  ├─ SplashScreen renders
  ├─ checkAuth() gọi verifySession (có timeout 10s)
  ├─ AuthStatus → authenticated
  ├─ SplashScreen: location == '/' → go('/attendance')
  └─ User manually navigate sang /account → OK

Reload page at /account (fix state A/B/C applied)
  ├─ app.dart: authStatus == unknown → redirect → /
  ├─ SplashScreen renders
  ├─ checkAuth() gọi verifySession (có timeout 10s)
  ├─ AuthStatus → authenticated
  ├─ SplashScreen: location == '/' → go('/attendance')
  └─ User manually navigate sang /account → OK
```

## 5. Kiểm tra

- Login → switch tab nhanh 5-10 lần → không stuck
- Stop server sau login → switch tab → không loading vô hạn
- Reload ở từng tab (Chấm công / Yêu cầu / Tài khoản) → giữ nguyên tab
- Token hết hạn → redirect về /login

## 6. Lỗi thường gặp

| Lỗi | Nguyên nhân | Fix |
|---|---|---|
| `GoRouter.of(context).location` undefined | go_router ^17 không có getter `location` | Dùng `GoRouter.of(context).state.matchedLocation` |
| SplashScreen chuyển về `/attendance` dù đang ở `/account` | Hardcode `context.go('/attendance')` | Kiểm tra `matchedLocation` trước |
| AccountScreen loading vô hạn sau reload | `app.dart` redirect `null` khi unknown | Redirect về `/` thay vì `null` |
| `checkAuth()` treo vô hạn | Không có timeout trên verifySession | `.timeout(Duration(seconds: 10))` |

## 7. Tài liệu tham khảo

- `.edits/fix1.md` — fix gốc cho bottom tab stuck loading
- `lib/app.dart` — GoRouter config
- `lib/screens/splash_screen.dart` — auth listener + redirect
- `lib/providers/providers.dart` — checkAuth + routerRefreshProvider
