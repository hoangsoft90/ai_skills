---
name: expo-apk-standalone
description: Đảm bảo APK Expo/React Native build ra CHẠY ĐƯỢC standalone trên máy thật (không cần Metro dev server) + chẩn đoán lỗi "Unable to load script" khi app cài vào phone không mở được. Áp dụng cho MỌI project Expo/RN (dùng chung, không phụ thuộc repo). Kích hoạt khi user báo "app không mở được", "cài vào máy rồi bị trắng hình", logcat có "Unable to load script" hoặc "ws://localhost:8081", hoặc trước khi thiết kế build pipeline cho app Expo.
---

# APK chạy standalone trên máy thật (không cần Metro) — dùng chung cho mọi project Expo/RN

## Khi nào dùng skill này

- User báo: "cài app vào phone rồi **không mở được** / mở lên bị trắng hình / tự tắt".
- Vừa build APK (local hoặc CI) và sắp cài lên máy thật test.
- Đang THIẾT KẾ build pipeline cho app Expo/RN — quyết định artifact chạy thế nào NGAY TỪ ĐẦU (bài học "tránh code xong đi sửa").

## Triệu chứng (nhận diện trong 5 giây)

1. Mở app → splash rồi **trắng hình/tự thoát**.
2. Logcat có 1 trong các dòng sau:

```
Unable to load script. Make sure you're running Metro or that your bundle
'index.android.bundle' is packaged correctly for release.

W unknown:ReconnectingWebSocket: Couldn't connect to "ws://localhost:8081/..."
ReactHost: ... Fault reason: Unable to load script.
```

→ **Diagnosis: APK là DEBUG build mà KHÔNG nhúng JS bundle**, nó đang tìm Metro dev server ở `localhost:8081` (máy thật không có) nên chết.

## Nguyên nhân gốc

`./gradlew assembleDebug` (mặc định của workflow GH Actions no-EAS) **KHÔNG bundle JS vào APK** — bundle được load từ Metro lúc chạy. Cài lên máy thật không có Metro = app không thể mở. Build "thành công" trên CI ≠ APK chạy được (chỉ bundle JS qua `expo export` cũng không bắt được lỗi này).

## Cách fix (áp dụng chung — CHỌN THEO RN VERSION)

**Bắt buộc nhúng JS vào debug APK** bằng config plugin (sống sót qua `expo prebuild --clean`) chèn vào `react {}` block của `android/app/build.gradle`:

| RN version | Property đúng trong `react {}` |
|---|---|
| RN ≤ 0.7x | `bundleInDebug = true` |
| RN 0.76+ / Expo SDK 5x (0.86) | `debuggableVariants = []` — `bundleInDebug` ĐÃ BỊ XÓA khỏi `ReactExtension`, gradle fail `Could not set unknown property 'bundleInDebug'` |

### ⚠️ BƯỚC BẮT BUỘC: verify property theo đúng RN version TRƯỚC khi chốt (không copy từ blog cũ)

Lỗi từng mắc thật (CI fail ở configuration phase): chèn `bundleInDebug = true`, grep file sinh ra thấy pass, nhưng gradle reject vì RN 0.86 đã xóa property. **Verify trong chính node_modules của project** (không cần build full):

```bash
# Property nào thực sự tồn tại trong RN version hiện tại?
grep -n "debuggableVariants\|bundleInDebug" \
  node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/ReactExtension.kt
# Cách plugin dùng property đó (debuggableVariants -> variant KHÔNG được bundle):
grep -n "debuggableVariants" \
  node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/src/main/kotlin/com/facebook/react/TaskConfiguration.kt
```

### Template plugin (generic — thay `<project>` bằng đường dẫn project của bạn)

Tạo `<project>/plugins/embed-js-in-debug.js`:

```js
const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withEmbedJsInDebug(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    // Guard bằng MARKER RIÊNG của plugin — không guard bằng tên property:
    // file build.gradle sinh ra ĐÃ có sẵn comment mẫu `// debuggableVariants = [...]`,
    // guard theo tên property = no-op vĩnh viễn (bug thật đã gặp).
    if (contents.includes('// bundle JS into the debug APK')) return config;

    const updated = contents.replace(
      /react\s*\{/,
      'react {\n        // bundle JS into the debug APK so it runs standalone without Metro (added by embed-js-in-debug)\n        debuggableVariants = []'  // đổi theo RN version, xem bảng trên
    );
    if (updated === contents) {
      throw new Error('embed-js-in-debug: could not find "react {" block in app/build.gradle');
    }
    config.modResults.contents = updated;
    return config;
  });
};
```

Đăng ký trong `app.json` → `plugins`: thêm `"./plugins/embed-js-in-debug"`.

### Verify TRƯỚC khi push (bắt lỗi ngay, không đợi CI)

```bash
cd <project>
npx expo prebuild --platform android --no-install   # sinh android/ cục bộ
grep -n -A4 "react {" android/app/build.gradle      # phải thấy debuggableVariants = [] / bundleInDebug = true
grep -n "applicationId" android/app/build.gradle    # package phải đúng
grep -n "app_name" android/app/src/main/res/values/strings.xml  # tên app phải đúng
```

`.gitignore` phải có `/<project>/android/` + `/<project>/ios/` (prebuild-generated, CI tự sinh lại — đừng commit).

## Flow kiểm tra trên máy thật (adb)

```bash
adb devices -l                              # máy có kết nối?
adb install -r app-debug.apk                # -r = cài đè (bản cũ)
adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1   # mở app
sleep 4
adb shell "dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity'"  # app có ở foreground?
adb logcat -d | grep -iE "FATAL|Unable to load script|ReactNativeJS|E ReactNative" | tail -30
adb exec-out screencap -p > /tmp/screen.png  # chụp màn hình kiểm tra
```

- App ở foreground + logcat không có `Unable to load script`/`FATAL` → OK.
- Còn `Unable to load script` → bundle chưa vào APK (kiểm tra lại bước verify).

## Design-time checklist (tránh "code xong đi sửa mất thời gian")

Chốt NHỮNG ĐIỀU NÀY Ở GIAI ĐOẠN THIẾT KẾ build pipeline, KHÔNG đợi user cài vào máy mới phát hiện:

1. **Artifact chạy standalone hay dev-mode?** Nếu user sẽ tự cài APK test (không có Metro chạy) → phải nhúng bundle (debuggableVariants/bundleInDebug/release) ngay từ build đầu tiên.
2. **App identity chốt trước build lần đầu**: `android.package`, `ios.bundleIdentifier`, `name`, `scheme`, keystore. Đổi package SAU khi đã cài app = user phải gỡ bản cũ, mất dữ liệu local, bản cũ tồn đọng (package khác = 2 app cạnh nhau). Identity là quyết định thiết kế, không phải chỗ đổi sau.
3. **Config plugin native phải verify API theo đúng RN version** (grep `ReactExtension.kt`) — không copy property từ bài blog/version cũ (`bundleInDebug` → `debuggableVariants`).
4. **Build success ≠ chạy được** — sau build đầu tiên của pipeline mới: cài lên máy + logcat + screencap NGAY, trước khi báo user "xong".
5. **`adb logcat -c` trước khi mở app** để log sạch, dễ đọc lỗi.

## Liên hệ

- Quy trình build APK qua GH Actions (generic): skill `expo-build-debug-apk-gh`.
- Native build failure (Kotlin metadata, pin dependency): skill `gh-actions-expo-apk-build`.
