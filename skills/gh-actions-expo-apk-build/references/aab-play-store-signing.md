# AAB Production Signing (Play Store) via EAS

For Play Store submission use **EAS Build production** — NOT the GitHub Actions debug-signed APK workflow. This reference covers the full credential flow: keystore, Play App Signing, and `eas submit`.

## Decision: two keys, one managed by you, one by Google

| Key | Who holds it | What it does |
|---|---|---|
| **Upload key** (keystore `.jks`) | You — generated & stored by **EAS servers** | Signs the `.aab` before upload |
| **App Signing key** | **Google Play** (Play App Signing) | Re-signs final APKs delivered to users |

They must be different keys. EAS manages your upload keystore; Play App Signing enrollment happens on the Play Console side (usually automatic on first upload via `eas submit`).

Key benefit: because Google holds the final signing key, **losing the upload keystore is recoverable** — reset the upload key via Google Play Support without losing the app listing.

## 1. `eas.json` production profile

Add to your existing `eas.json` (alongside `preview`):

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": {
        "buildType": "app-bundle",
        "autoIncrement": true
      },
      "credentialsSource": "remote"
    }
  },
  "submit": { "production": {} }
}
```

- `buildType: "app-bundle"` → produces `.aab` (Play requires AAB; `apk` is for test/preview only).
- `autoIncrement: true` → auto-bumps Android `versionCode` (and iOS `buildNumber`) per build.
- `credentialsSource: "remote"` (default) → EAS generates/uses the keystore from its servers. Set `"local"` only if you manage the keystore file yourself.

## 2. First build: EAS creates the keystore

```bash
npx eas-cli login        # needs EXPO_TOKEN or interactive login
npx eas-cli build --platform android --profile production --non-interactive
```

First run: EAS generates an upload keystore and stores it encrypted on EAS servers (Google Cloud KMS). Later builds automatically reuse it. `eas init` may also create a local `credentials.json`, but it only holds **metadata, not the keystore** — the real backup is step 3 below.

## 3. Back up the keystore NOW (do not skip)

```bash
npx eas-cli credentials --platform android
# → select production profile
# → "credentials.json: Upload/Download credentials between EAS servers and your local json"
# → "Download credentials from EAS to credentials.json"
```

Store `credentials.json` + the keystore securely (password manager / offline). Add `credentials.json` to `.gitignore` — **never commit keystores or `credentials.json` to git**.

## 4. If the upload keystore is lost

1. Download current credentials metadata (see step 3) to get the alias.
2. Export the certificate to PEM:
   ```bash
   keytool -export -rfc -alias <alias> -file certificate_for_google.pem -keystore ./keystore.jks
   ```
3. Contact **Google Play Support** (official upload-key reset form), attach the new PEM certificate.
4. Google requires the new upload certificate to have **≥72 hours of remaining validity** at submission time — if the cert is fresher than that, wait until it clears 72h before publishing again.

Play App Signing key itself is held by Google — it cannot be lost by you.

## 5. Upload to Play Store (`eas submit`)

Needs a **Google Play Console service account JSON** (with Release Manager / app permission):

1. Google Cloud Console → create a service account → download private key as JSON.
2. Upload it to EAS:
   ```bash
   npx eas-cli credentials --platform android   # → production → service account JSON
   ```
   (or via expo.dev dashboard → project → Credentials → Add Google Service Account Key)
3. Submit:
   ```bash
   npx eas-cli submit --platform android            # picks the latest build
   # or chain after build:
   npx eas-cli build --platform android --profile production --auto-submit
   ```
4. Choose the Play track (internal / beta / production) and app ID.

## Checklist before first release

- [ ] `eas.json` production profile: `buildType: app-bundle` + `autoIncrement: true`
- [ ] Keystore backed up (`eas credentials` → download `credentials.json`) and gitignored
- [ ] Google Play Console: app created, **Play App Signing** enrolled
- [ ] Service account JSON uploaded to EAS credentials
- [ ] `google-services.json` matches the Play app's package (`<package>` — e.g. `com.hoangweb.prompttemplate` for the reference project)
- [ ] AdMob app linked to the Play app ID (ads fill after store publish, often 1–2 days)

## Security notes

- Upload keystore and service-account JSON are **secrets** — never commit, never paste into chat, never print in CI logs.
- If a token/secret was ever shared in a chat, revoke and rotate it (EXPO_TOKEN, service account, GH token).
