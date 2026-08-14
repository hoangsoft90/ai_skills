---
name: release
description: Đóng gói app Flutter thành file APK (hoặc IPA nếu trên Mac) khi user yêu cầu rõ ràng "build apk", "đóng gói", "xuất bản". KHÔNG tự động build sau mỗi tính năng - chỉ chạy khi được yêu cầu trực tiếp.
---

# Release

## Trigger

Chỉ load khi user nói rõ dạng: "build apk", "đóng gói app", "xuất file cài đặt", "release". Không tự suy ra từ việc hoàn thành 1 tính năng.

## Quy trình APK (Android)

1. Xác nhận đã qua `git-checkpoint` gần nhất (code đang ở trạng thái sạch, đã commit) - nếu chưa, nhắc user commit trước khi build.
2. Chạy: `flutter build apk --split-per-abi` (giảm kích thước file so với build gộp).
3. Copy file `.apk` ra thư mục `output/` ở root project kèm tên có version (ví dụ `output/app-v1.2.0.apk`).
4. Báo user đường dẫn file, không cần giải thích dài dòng thêm.

## Quy trình iOS (chỉ khi đang chạy trên máy Mac)

1. Kiểm tra môi trường: nếu không phải macOS → DỪNG, báo user cần máy Mac để build iOS, đây thuộc nhóm "yêu cầu phần cứng" không tự động hóa được.
2. Nếu là Mac: `flutter build ipa`, cần Apple Developer signing đã cấu hình sẵn (không tự tạo cert/profile thay user).
3. Copy `.ipa` ra `output/`.

## Version bump

- Trước khi build, hỏi hoặc tự tăng version theo semver dựa trên nội dung CHANGELOG kể từ lần build trước (patch nếu chỉ sửa lỗi, minor nếu thêm tính năng) - nếu không chắc, hỏi user 1 câu ngắn thay vì tự đoán sai version.

## Không nằm trong phạm vi skill này

- Không tự động submit lên Play Store/App Store (Fastlane, signing production) trừ khi user yêu cầu riêng và có đủ credentials - phần này rủi ro cao hơn, cần xác nhận rõ ràng từng bước.
