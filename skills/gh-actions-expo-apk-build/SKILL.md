---
name: gh-actions-expo-apk-build
description: Build an Expo React Native Android APK on GitHub Actions without EAS. Use when the user wants to build an APK/AAB from CI, set up a GitHub Actions workflow for expo prebuild + gradle assembleRelease, fix Android build failures in CI (Kotlin metadata mismatch, play-services-ads version conflicts, RNGMA/patch-package), download the APK artifact, or asks why the Android build fails with "incompatible version of Kotlin". Covers APK (release-signed via keystore, or debug-signed for quick tests) vs AAB (Play Store) choices and native dependency pinning. For signing/verify specifics (Play Console debug-mode rejections, apksigner vs jarsigner) see the android-release-signing skill.
---

# GitHub Actions: Build Expo Android APK/AAB

Build a release Android APK for an Expo (React Native) app on GitHub Actions without paying for or waiting on EAS cloud. Proven on Expo SDK 57 / RN 0.86 with react-native-google-mobile-ads.

## When to use (vs EAS)

| Situation | Use |
|---|---|
| Test APK on a real device, free, no token, auto on every push | **This skill (GH Actions)** |
| EAS free tier stuck `IN_QUEUE` for 30+ min | **This skill (GH Actions)** |
| Upload to Play Store (AAB, proper signing, Play App Signing) | EAS Build `production` profile |
| Need iOS build | EAS Build (GH Actions has no macOS here) |

APK built by this workflow is signed with the **debug keystore** by
default — installable on devices. For a **release-signed** APK/AAB (needed
for Play Console), pass the release keystore + signing plugin: see the
`android-release-signing` skill (proven: GH Actions can produce
release-signed artifacts without EAS).

## Decision order

1. APK (test) → workflow below, no secrets needed (debug keystore) or with
   keystore secrets for a release-signed APK.
2. AAB (store) → sign with the project release keystore inside the workflow
   (decode keystore secret → `expo prebuild` with signing plugin →
   `./gradlew bundleRelease`). This works without EAS; see
   `references/aab-play-store-signing.md` and the `android-release-signing`
   skill. (EAS Build is an alternative if you prefer EAS-managed signing.)
3. Build failing with a Kotlin/version error → read `references/troubleshooting.md` FIRST. These are the 5-fix failure modes that cost hours.

## Procedure (APK, test build)

### 1. Preconditions
- Repo is pushed to GitHub (workflow only runs there).
- `google-services.json` (if the app uses Firebase/AdMob) is **committed**.
- `android/` is **NOT committed** (gitignored) — CI regenerates it via `expo prebuild`.
- Default branch is `main` (rename `master` first: `git branch -M main`) or adjust the trigger.

### 2. Create the workflow

Open `references/workflow-template.md` and write `.github/workflows/build-apk.yml` from the base template. Keep the canonical step order: checkout → Node → JDK 17 → Android SDK → `npm ci` → `expo prebuild --clean --no-install` (with `CI: 1`) → `./gradlew assembleRelease` → `upload-artifact`.

- JDK **17** for Expo SDK 52+ / RN 0.7x+ (21 is not required).
- Always `--clean` on prebuild so `android/` matches `app.json` (plugins, google-services, proguard).
- Validate the YAML before pushing (see below).
- Set `if-no-files-found: error` on the upload step.

### 3. Push and monitor

```bash
git add -A && git commit -m 'ci: add APK build workflow' && git push origin main
gh run list --repo <owner>/<repo> --limit 3
gh run watch <run-id> --repo <owner>/<repo>      # or poll via gh run view --json status,conclusion
gh run view <run-id> --repo <owner>/<repo> --log-failed   # when it fails — read THIS, not the full log
```

First build takes ~15–25 min (dependency download). Debug CI with `--log-failed`, then `--log | grep <keyword>` for specifics.

### 4. Download the artifact

Artifacts expire after 90 days.

```bash
gh run download <run-id> --repo <owner>/<repo> --dir apk --pattern '*.zip'
# or, faster for large artifacts:
gh api repos/<owner>/<repo>/actions/artifacts --jq '.artifacts[] | select(.workflow_run.id==<run-id>) | {name, id, size_in_bytes, archive_download_url}'
curl -sL -H "Authorization: Bearer $GH_TOKEN" -o apk/artifact.zip '<archive_download_url>'
unzip -o -q apk/artifact.zip -d apk && ls -lh apk/*.apk
```

Keep `GH_TOKEN` in an env var / shell export; never print it.

### 5. If the build fails with a compile error
Open `references/troubleshooting.md` — the Kotlin-metadata and version-pin section covers the exact failure ladder hit by react-native-google-mobile-ads 16.x on RN 0.86.

### 6. AAB / Play Store release
Open `references/aab-play-store-signing.md` BEFORE building a store release. Two options:

**Option A — release keystore in the GH Actions workflow (no EAS, proven).**
Add keystore secrets (`ANDROID_KEYSTORE_BASE64/PASSWORD/ALIAS/KEY_PASSWORD`),
decode them in the workflow, and run `expo prebuild` with a signing config
plugin so `bundleRelease` produces a release-signed AAB. Full details +
verify steps (jarsigner, not apksigner, for AAB) in the
`android-release-signing` skill. Back up the keystore locally — losing it
means losing the ability to update the app.

**Option B — EAS Build.** `npx eas-cli build --platform android --profile production` — EAS generates/manages the upload keystore on its servers. Requires the user's `EXPO_TOKEN` (agent can't run it without it). Steps:

1. Ensure `eas.json` has a `production` profile with `buildType: "app-bundle"` and `autoIncrement: true`.
2. `npx eas-cli build --platform android --profile production`.
3. **Back up the keystore**: `npx eas-cli credentials --platform android` → download `credentials.json` (gitignore it).
4. Upload a Play service-account JSON to EAS credentials, then `npx eas-cli submit --platform android`.
5. Never commit keystores.

## Reference routing

| Open when... | File |
|---|---|
| Writing or adjusting the workflow YAML (steps, JDK/Node versions, caching, debug/release variants, secrets) | `references/workflow-template.md` |
| Building for the Play Store: AAB, keystore, Play App Signing, `eas submit`, keystore backup/recovery | `references/aab-play-store-signing.md` |
| Build fails at `compileReleaseKotlin` / "incompatible version of Kotlin" / "binary version of its metadata" / any native dependency version conflict | `references/troubleshooting.md` |
| Need to pin a transitive Gradle dependency via config plugin | `scripts/pin-gradle-dependency.js` (copy into `plugins/` and register in `app.json`) |
| Update/maintain this skill's contract | `SPEC.md` |

## Security notes
- Never commit keystores or secrets. Debug keystore builds need no secrets.
- If a token (EXPO_TOKEN, GH_TOKEN/ghp_*) was ever pasted into a chat, tell the user to revoke it after the build finishes.
- Token in push URL leaks via `git remote -v`: push with `git -c http.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64)" push origin main` instead.

## AAB signing essentials

- **Upload key vs App Signing key**: your keystore (project-managed in the workflow, or EAS-managed) signs the AAB; Google's Play App Signing key re-signs user APKs. They must differ, and losing your upload key is recoverable (Google Play Support reset, with a 72-hour validity window) because Google holds the final key.
- **Back up the keystore immediately** after the first production build (`eas credentials` → download `credentials.json`); never commit it.
- **`eas submit` needs a Google Play service-account JSON** (Release Manager permission) uploaded to EAS credentials.

## Golden rules (learned the hard way)
- **Don't bump Kotlin to read newer metadata.** Raising `kotlinVersion` can break other libs (e.g. react-native-safe-area-context crashes on Kotlin 2.3) and still not fix the module. Pin the offending native dependency DOWN instead.
- **`expo-build-properties` `kotlinVersion` only writes gradle.properties** — it does NOT override the RN version catalog, so it often has zero effect. Verify in `android/gradle/libs.versions.toml` after prebuild.
- **Verify the real cause before patching.** Resolve what version Gradle actually picked and inspect the module's Gradle file / AAR metadata; guessing causes repeated failed runs.
- **Config-plugin pins are the durable fix** (prebuild regenerates `android/` each run); hand-editing `android/build.gradle` is wiped on the next prebuild.
- **When a pinned version lacks APIs the module calls**, the compiler error names the exact symbol — patch only those call sites via patch-package, with a safe fallback, and verify the patch applies on a pristine copy.
