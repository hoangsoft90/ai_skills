---
name: expo-build-debug-apk-gh
description: Build debug APK cho app Expo/React Native trên GitHub Actions (gradle trực tiếp, không EAS token) — push code lên branch build rồi tải APK debug về để test lỗi thật trên máy. Áp dụng chung cho MỌI project Expo/RN. Dùng khi user yêu cầu "build apk", "tải apk test", "thấy lỗi trên máy thật", "push build gh actions".
---

# Build Debug APK qua GitHub Actions (app Expo/RN — dùng chung mọi project)

## 1. ⚠️ BẮT BUỘC: debug APK phải nhúng JS bundle (nếu không app chết "Unable to load script")

`assembleDebug` mặc định **KHÔNG bundle JS vào APK** — APK tìm Metro dev server ở `localhost:8081`. Cài lên máy thật không có Metro → app mở lên rồi chết/trắng hình (logcat: `Unable to load script ... Make sure you're running Metro`).

Cách fix: config plugin chèn vào `react {}` block của `android/app/build.gradle` (xem chi tiết skill `expo-apk-standalone` — gồm bảng property theo RN version + bước verify `ReactExtension.kt`):

- RN ≤ 0.7x: `bundleInDebug = true`
- RN 0.76+ / Expo SDK 5x: `debuggableVariants = []` (bundleInDebug đã bị xóa)

Kiểm tra plugin còn hoạt động trước mỗi lần push build:

```bash
cd <project>            # thư mục app Expo (vd: apps/mobile)
npx expo prebuild --platform android --no-install
# PHẢI thấy debuggableVariants = [] (hoặc bundleInDebug = true theo RN version):
grep -n -A4 "react {" android/app/build.gradle
# PHẢI thấy applicationId + app_name đúng:
grep -n "applicationId" android/app/build.gradle
grep -n "app_name" android/app/src/main/res/values/strings.xml
```

## 2. Quy trình (khi user muốn build APK test)

### a. Đảm bảo code sạch lỗi trước khi push (theo AGENTS.md)

CI chỉ build, không sửa lỗi:

```bash
cd <project>
npx tsc --noEmit           # typecheck
npm run lint               # lint
npx jest                   # test
npx expo export --platform android 2>&1 | tail -2   # bundle check
```

### b. Commit + push lên branch build

```bash
cd <project-root>
git add -A
git commit -m "message"
git push origin <branch>   # workflow trigger tự động
```

⚠️ Push KHÔNG lộ token trong remote URL — dùng header hoặc URL tạm (token do user cấp trong từng phiên, không hardcode; nhắc user revoke sau khi xong).

### c. Theo dõi workflow (không cần đợi build xong nếu user không yêu cầu)

```bash
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/<owner>/<repo>/actions/runs?per_page=3"
```

### d. Tải APK về khi build xong

```bash
# Lấy artifact download URL:
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/<owner>/<repo>/actions/artifacts" | python3 -m json.tool
# Download + giải nén:
curl -sL -H "Authorization: Bearer $GH_TOKEN" -o apk.zip "<archive_download_url>"
unzip -o -q apk.zip && ls -lh *.apk
```

APK nằm trong artifact `<tên-artifact>` (`app-debug.apk`), signed bằng debug keystore — cài lên máy test được, không submit store.

## 3. Chi tiết workflow (debug APK, no keystore) — áp dụng chung

- **Build:** `./gradlew assembleDebug` (không cần keystore riêng — debug keystore mặc định của Gradle) — kèm bundle JS qua config plugin (mục 1)
- **Upload:** `android/app/build/outputs/apk/debug/app-debug.apk`
- **Bước chuẩn:** checkout → Node (LTS) → JDK 17 → Android SDK (accept licenses) → `npm ci` → `expo prebuild --platform android --clean --no-install` (CI=1) → `gradlew assembleDebug` → upload
- **KHÔNG dùng:** EAS token, keystore production, signing release
- **Native config chỉ lộ lỗi khi build thật**: nếu build fail, đọc log step "Build debug APK" — các lỗi thường gặp: pin transitive dependency theo Kotlin metadata (xem skill `gh-actions-expo-apk-build`), property `react {}` sai theo RN version (mục 1).

## Tại sao build APK mới tìm chính xác lỗi

- `npx expo export` chỉ bundle JS — không bắt lỗi native (AdMob, WebView, Gradle, manifest).
- Debug APK cài lên máy thật mới lộ: lỗi native module, manifest, ads hiển thị, navigation bar che UI.
- Luôn khuyên user: "build APK rồi cài lên máy để test lỗi thật" khi nghi ngờ lỗi native/runtime.

## Đổi sang Release APK (khi cần)

Chỉnh workflow: `assembleDebug` → `assembleRelease` + path `apk/release/app-release.apk`. Release APK từ GH Actions vẫn debug-signed (không submit store). Muốn AAB/Play Store → dùng EAS production (xem skill `gh-actions-expo-apk-build`).
