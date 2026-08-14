# GitHub Actions Expo APK Build Specification

## Intent

Let an agent build a release Android APK for an Expo app on GitHub Actions (no EAS, no token, free), diagnose and fix the class of native compile failures that plague such builds (Kotlin metadata mismatch, transitive native dependency version conflicts, missing 25.x-only APIs), and hand the user an installable artifact with a verify checklist.

## Scope

In scope:
- Writing/validating `.github/workflows/build-apk.yml` (APK, debug-signed, release variant)
- Pushing, triggering, monitoring runs via `gh` CLI, downloading artifacts
- Fixing `compileReleaseKotlin` / "incompatible version of Kotlin" failures
- Pinning transitive Gradle dependencies via Expo config plugins
- Patching node_modules via patch-package (pristine-diff fallback)
- AAB production release via EAS: `eas.json` production profile, upload-keystore generation/backup/recovery, Play App Signing, `eas submit` with a Google Play service-account JSON

Out of scope:
- Actually operating the Google Play Console / Play App Signing enrollment UI (the user does that; the skill guides the CLI parts)
- iOS builds
- Local Android SDK/emulator setup (the skill assumes CI-only debugging)

## Users And Trigger Context

- Primary users: solo devs with an Expo app and no EAS budget or a stuck EAS queue.
- Common requests: "build APK on GitHub Actions", "APK build fails with Kotlin metadata error", "make an AAB", "where is my APK artifact".
- Should not trigger for: EAS builds, iOS builds, pure-JS bug fixing, Flutter/Android-native projects.

## Runtime Contract

- Required first actions: check trigger (APK vs AAB vs fix-failure) → preconditions (branch `main`, `google-services.json` committed, `android/` gitignored; for AAB: `eas.json` production profile + EAS login).
- Required outputs: workflow file (or a fix + push), run monitored to completion, artifact path + install/verify checklist, secret-revocation reminder if a token was shared; for AAB: keystore backup reminder + service-account JSON guidance.
- Non-negotiable constraints: no production keystores in the repo; do not bump Kotlin to fix metadata (pin DOWN instead); verify patches on a pristine copy.
- Bundled files loaded at runtime: `references/workflow-template.md`, `references/troubleshooting.md`, `scripts/pin-gradle-dependency.js`.

## Source And Evidence Model

Authoritative sources:
- Expo docs: `expo prebuild`, CI/local builds (docs.expo.dev)
- GitHub Actions docs: `upload-artifact`, `setup-java`, `setup-node`, `android-actions/setup-android`
- Live reproduction: PromptTemplateManager repo (Expo SDK 57, RNGMA 16.4.0) — 5 failed CI runs fixed in sequence

Useful improvement sources:
- positive examples: the final green run of the reference repo (run id archived in repo history)
- negative examples: each of the 5 failed runs (Kotlin 2.3.21 bump, version-catalog non-override, 25.3.0 mis-pin, one-sided patch)
- commit logs: `fix: pin play-services-ads ...`, `fix: full RNGMA patch ...` in the reference repo
- validation results: `--log-failed` output classes, `patch --dry-run` on pristine copy, `javap` API checks

Data that must not be stored: API tokens, keystores, AdMob app secrets.

## Reference Architecture

- `SKILL.md`: routing, decision order, golden rules
- `references/workflow-template.md`: YAML base + variants (debug/release/caching) + AAB pointer
- `references/aab-play-store-signing.md`: keystore, Play App Signing, `eas.json` production, `eas submit`, keystore backup/recovery
- `references/troubleshooting.md`: 4-rung failure ladder + anti-pattern table
- `scripts/pin-gradle-dependency.js`: reusable config-plugin template
- `SPEC.md`: this contract

## Validation

- Lightweight: YAML parses (`yaml.safe_load` or actionlint); config plugin `node -c`-style syntax check; `expo prebuild` locally + `grep resolutionStrategy.force android/build.gradle`.
- Deeper: full CI run to green; artifact download + `unzip -l` sanity; `strings AndroidManifest.xml | grep <pkg>`.
- Acceptance gates: workflow triggers on push; APK artifact exists with `if-no-files-found: error`; no token printed; user handed install + verify checklist.

## Known Limitations

- Version numbers (JDK 17, Node 22, ads 24.2.0, Kotlin 2.1/2.3) are proven for Expo SDK 57 / RN 0.86; newer SDKs may change defaults — re-verify before applying blindly.
- The patch-package pristine-diff fallback assumes `npm pack` output layout.
- Cannot test real ad fill (AdMob latency, device geo) — only pipeline correctness.
- AAB guidance describes the EAS-managed (remote) credential flow; local-keystore setups and Google Play Console UI specifics may differ.

## Maintenance Notes

- Update `references/aab-play-store-signing.md` when EAS credentials CLI (`eas credentials` menus) or submit flow changes significantly.

## Maintenance Notes

- Update `SKILL.md` when: a new failure rung appears, or the golden rules change.
- Update `references/troubleshooting.md` when: a new version ladder is discovered for a newer Expo SDK.
- Update `SPEC.md` when: scope or evidence model changes.
