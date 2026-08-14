# Workflow Template

Base APK workflow (debug-signed). Copy into `.github/workflows/build-apk.yml` and adjust the artifact name.

```yaml
name: Build Android APK

on:
  workflow_dispatch:            # manual "Run workflow" button in the Actions tab
  push:
    branches: [main]            # remove if you only want manual builds

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Setup Java (JDK 17 — required for Expo SDK 52+ / RN 0.7x+)
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Setup Android SDK (accepts licenses + build-tools)
        uses: android-actions/setup-android@v3

      - name: Install dependencies
        run: npm ci

      - name: Generate native project (expo prebuild)
        run: npx expo prebuild --platform android --clean --no-install
        env:
          CI: '1'

      - name: Build release APK
        working-directory: android
        run: ./gradlew assembleRelease

      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: <app>-apk
          path: android/app/build/outputs/apk/release/app-release.apk
          if-no-files-found: error
```

## Step order — do not reorder
`checkout → node → JDK 17 → Android SDK → npm ci → prebuild → gradle → upload`. Gradle without the Android SDK setup step fails on missing licenses/build-tools; prebuild without `CI: 1` can prompt interactively.

## Variants

| Want | Change |
|---|---|
| Manual builds only | Remove the `push:` block (keep `workflow_dispatch`) |
| Debug APK (faster, `__DEV__=true` so real ad IDs stay OFF) | `./gradlew assembleDebug` + upload `app-debug.apk` |
| Release APK with REAL ad IDs | keep `assembleRelease` (default — `__DEV__=false`) |
| Speed up rebuilds | Add `gradle/gradle-build-action@v3` after checkout to cache `~/.gradle` |
| AAB (store) | Do NOT build it here with the debug key — use **EAS production** (`references/aab-play-store-signing.md`). Production signing keys never live in this workflow |
| Private repo limits | Free 2,000 min/month (~1 build ≈ 20 min); public repos free |

## AAB (Play Store) — use EAS, not this workflow

GitHub Actions builds here are **debug-signed test APKs**. For store submission:

1. Add a `production` profile to `eas.json` with `buildType: "app-bundle"` + `autoIncrement: true` (see `references/aab-play-store-signing.md`).
2. Run `npx eas-cli build --platform android --profile production` (EAS manages the upload keystore on its servers).
3. Back up the keystore via `npx eas-cli credentials` → download `credentials.json`, gitignore it.
4. Upload a Google Play service-account JSON to EAS credentials, then `npx eas-cli submit --platform android`.

## Behavior notes
- `expo prebuild --clean` regenerates `android/` from `app.json` every run — AdMob/Firebase plugins, `google-services.json` wiring, and proguard rules are applied fresh, so no stale native project.
- Release APK is signed with the template's **debug keystore** (auto-generated in CI) — installs fine, never store-submittable.
- `node_modules` is gitignored in a normal Expo project → `npm ci` in CI. `postinstall` scripts (e.g. `patch-package`) run automatically.

## YAML validation (before pushing)
GitHub parses `on:` fine, but PyYAML 1.1 maps it to boolean `True`. Validate with `python3 -c "import yaml,sys; y=yaml.safe_load(open('.github/workflows/build-apk.yml')); print('ok', y['name'], list(y['jobs']))"` and ignore the `True` key quirk, or just rely on `actionlint`.

## Branch gotchas
- Workflow triggers on `[main]`. Fresh repos often default to `master` → `git branch -M main` before pushing.
- Empty remote: `git remote add origin <url>` then push; the first push runs the workflow automatically.
