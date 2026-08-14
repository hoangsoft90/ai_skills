---
name: gh-actions-build-trigger
description: GH Actions workflow triggering/monitoring gotchas for the Prompt Template Manager repo (APK + AAB). Use when a push to main did not seem to trigger a workflow, when only .github/** changed (paths filters skip it, needs manual dispatch), when parallel APK+AAB runs need one cancelled, when a build failed and the job log must be pulled, or when checking run status/artifacts. For the end-to-end build flow (preflight, commit, push, watch, download) use gh-actions-apk-build instead.
---

# GH Actions build trigger — Prompt Template Manager

Repo: `https://github.com/hoangsoft90/PromptTemplateManager`.

Two workflows exist and **do not behave the same**:

| Workflow | Auto-trigger on push | Paths filter |
| --- | --- | --- |
| `build-apk.yml` (Build Android APK) | ✅ every push to `main` | none |
| `build-aab.yml` (Build Signed AAB) | ✅ push to `main` | **only app/**, components/, db/, hooks/, lib/, plugins/, types/, assets/, app.json, package*.json, patches/ — **NOT `.github/**`** |

## Steps

### 1. Decide which workflow(s) the request needs

APK for sideloading/testing, AAB for Play Store. If the user says "build
APK" only, cancel the AAB run; if "build AAB" only, cancel the APK run —
pushing to `main` triggers **both** (APK has no paths filter). Never let a
build the user did not ask for burn runner time.

### 2. Check whether a push will trigger the workflow

A push that touches **only `.github/**`** (workflow files, etc.) does **NOT**
trigger `build-aab.yml` — `.github/**` is not in its paths list. Pushing a
workflow-file-only commit will still trigger `build-apk.yml` (no filter).
For the AAB workflow in that case, use a manual dispatch (step 3) instead of
expecting the push to fire it.

### 3. Trigger (manual dispatch when needed)

```bash
curl -s -o /dev/null -w "dispatch: HTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/hoangsoft90/PromptTemplateManager/actions/workflows/build-aab.yml/dispatches" \
  -d '{"ref":"main"}'
```

`204` = accepted. After dispatch (or a push), **runs can take several seconds
to appear in the API** — the first query right after a push may return an
empty list. Sleep ~5–10s and re-query before concluding "nothing triggered"
(a classic race).

### 4. Monitor the run

```bash
curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/hoangsoft90/PromptTemplateManager/actions/runs?per_page=5" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); for (const r of d.workflow_runs||[]) console.log(r.id, r.name, r.head_sha.slice(0,7), r.status, r.conclusion, r.event)"
```

`conclusion: null` while running. If a run fails, pull the job log:

```bash
JOB_ID=$(curl -s -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/hoangsoft90/PromptTemplateManager/actions/runs/$RUN_ID/jobs" \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).jobs[0].id)")
curl -sL -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/hoangsoft90/PromptTemplateManager/actions/jobs/$JOB_ID/logs" -o /tmp/job.log
```

Then grep the log for the failing step (e.g. `grep -B2 -A12 "error"` or look
for `##[error]` / `Process completed with exit code 1`).

### 5. Cancel an unneeded parallel run

```bash
curl -s -o /dev/null -w "cancel: HTTP %{http_code}\n" -X POST \
  -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/hoangsoft90/PromptTemplateManager/actions/runs/$RUN_ID/cancel"
```

`202` = accepted. Note: cancelling is async — the run may show as "cancelled"
only after the runner notices.

Completion criterion: the correct workflow(s) for the request are running on
the intended commit, unneeded parallel runs are cancelled, and you know the
run ID + URL to report. If a build failed, you can name the failing step and
the error.

## Reference

- Token: `gh_token` is provided per session; export it as `GH_TOKEN` and
  never write it into files/commits.
- Artifacts: APK `prompt-template-manager-apk`, AAB
  `prompt-template-manager-aab`, uploaded by `actions/upload-artifact@v4`
  (path `android/app/build/outputs/.../release/app-release.{apk,aab}`).
- Build takes ~20–25 min first run.
