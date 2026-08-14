# Troubleshooting: Native Build Failures in CI

Failure ladder proven on Expo SDK 57 / RN 0.86 / react-native-google-mobile-ads (RNGMA) 16.4.0. Each rung below is a real failure mode; follow the ladder top-down instead of guessing.

## Read build failures fast

```bash
gh run view <run-id> --repo <owner>/<repo> --log-failed        # ONLY the failing steps
gh run view <run-id> --repo <owner>/<repo> --log | grep -i <keyword>   # then drill in
```

## Rung 1 — "Module was compiled with an incompatible version of Kotlin" (metadata X.Y.Z, expected 2.1.0)

Symptom: `:react-native-google-mobile-ads:compileReleaseKotlin FAILED` — the module's transitive native dependency is compiled with newer Kotlin metadata than the RN default compiler.

Cause example: RNGMA 16.4.0 resolves `com.google.android.gms:play-services-ads:25.4.0`, which is compiled with Kotlin 2.3 metadata; RN 0.86 defaults to Kotlin 2.1.

### First, confirm the versions Gradle actually resolves

```bash
# What the module pulls:
grep -rn 'play-services-ads' node_modules/react-native-google-mobile-ads/android/build.gradle
# Kotlin in the generated catalog (post-prebuild):
grep -n -A2 'kotlin' android/gradle/libs.versions.toml
# Kotlin written to gradle.properties by expo-build-properties:
grep -n 'kotlin' android/gradle.properties
```

### ⚠️ Do NOT bump Kotlin

`expo-build-properties.kotlinVersion` **only writes `android.gradle.properties`** — it does not override the RN version catalog (`android/gradle/libs.versions.toml`), so the compiler version may not change at all. And when it *does* take effect, Kotlin 2.3.x can crash other libs (observed: `react-native-safe-area-context` type-checker crash). Two ways to lose, one way to win.

### The fix: pin the native dependency DOWN to a Kotlin-compatible version

Do it with an Expo config plugin so it survives `expo prebuild --clean` (hand-edits to `android/build.gradle` are wiped). Use `scripts/pin-gradle-dependency.js` (copy to `plugins/`, register in `app.json` `plugins` array, then commit + push). It appends:

```groovy
subprojects {
  configurations.configureEach {
    resolutionStrategy.force 'com.google.android.gms:play-services-ads:<version>'
  }
}
```

Verify locally before pushing:
```bash
CI=1 npx expo prebuild -p android --no-install
grep -n 'resolutionStrategy.force' android/build.gradle   # block present
```

## Rung 2 — Pinned version is missing APIs the module calls

Symptom after Rung 1: compile error names a symbol not in the pinned version, e.g. `cannot find symbol AgeRestrictedTreatment` or `AdSize.getLargeAnchoredAdaptiveBannerAdSize` (both are play-services-ads 25.x-only).

### Verify which version has which API before choosing

```bash
# Available methods in a specific AAR version:
curl -sL -o /tmp/ads.aar 'https://dl.google.com/dl/android/maven2/com/google/android/gms/play-services-ads/<v>/play-services-ads-<v>.aar'
unzip -o -q /tmp/ads.aar classes.jar -d /tmp/ads && cd /tmp/ads
javap -classpath classes.jar com.google.android.gms.ads.AdSize | grep -i adaptive
```

Decision table (learned): all play-services-ads **25.x** ship Kotlin **2.3** metadata → unusable with Kotlin 2.1; **24.2.0** is Kotlin 2.1-safe but lacks 25.x APIs. There is often **no version** that is both Kotlin-safe and API-complete → you must patch the module (Rung 3).

## Rung 3 — Patch the module's call sites (patch-package)

The failing symbols are usually in dead code paths for the app (e.g. an option the app never sets). Remove/replace only those call sites with a safe fallback.

1. Edit `node_modules/<pkg>/...` (e.g. `ReactNativeGoogleMobileAdsModule.kt`, `ReactNativeGoogleMobileAdsCommon.java`; check both Android **and** iOS files — iOS compiles in its own CI).
2. Generate the patch. `npx patch-package <pkg>` may fail on some Node versions (temp-install issue) — fall back to a manual pristine diff:
   ```bash
   mkdir -p /tmp/pp && cd /tmp/pp && npm pack <pkg>@<ver> --pack-destination /tmp/pp
   tar -xzf /tmp/pp/*.tgz
   PRISTINE=/tmp/pp/package; MOD=<project>/node_modules/<pkg>
   diff -ruN "$PRISTINE" "$MOD" \
     | sed "s|$PRISTINE|a/node_modules/<pkg>|g; s|$MOD|b/node_modules/<pkg>|g" \
     | sed -e 's|^diff -ruN |diff --git |' -e 's|\t[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.*$||' \
     > patches/<pkg>+<ver>.patch
   ```
3. Verify the patch applies on a **pristine** copy (never trust "previously applied" on the already-patched tree):
   ```bash
   rm -rf /tmp/pptest && mkdir -p /tmp/pptest/node_modules
   cp -r /tmp/pp/package /tmp/pptest/node_modules/<pkg>
   (cd /tmp/pptest && patch --dry-run -p1 < <project>/patches/<pkg>+<ver>.patch)
   ```
4. Add `patch-package` + `"postinstall": "patch-package"` in package.json (runs automatically on `npm ci` in CI).

## Rung 4 — Still failing? Verify the patch actually ran in CI

- Check `--log-failed` — the error should have *changed*. Each rung eliminates one error class; a new error means the pin/patch is live.
- Confirm the pushed commit contains the change: `gh run view <id> --json headSha` vs `git rev-parse HEAD`.
- Confirm `postinstall` runs: the build log shows `> patch-package` during `npm ci`.

## Anti-patterns (each cost a failed CI run)

| Mistake | Why it fails |
|---|---|
| Bump `kotlinVersion` to match metadata | (a) property may not affect the catalog; (b) Kotlin 2.3 crashes other libs; (c) module may still fail |
| Edit `android/build.gradle` by hand | wiped on next `expo prebuild` |
| Pick a "newer" pinned version without checking APIs | module calls 25.x-only symbols → new compile error |
| Patch without a pristine dry-run | `patch --dry-run` on the already-patched tree says "previously applied" — false confidence |
| Fix one file but not the same block in the iOS twin | iOS-native CI builds the .mm twin and fails |

## Debugging without a local SDK (no adb/emulator/KVM)
You cannot run `expo run:android` locally. Debug purely from CI logs + local prebuild + local `node_modules` inspection; verify native wiring via `unzip -p app-release.apk AndroidManifest.xml | strings | grep <pkg>` and artifact checksums.
