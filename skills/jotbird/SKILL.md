---
name: jotbird-publish
description: Publish or update a Markdown document as a hosted web page using the JotBird API (jotbird.com). Use this whenever the user asks to "publish", "share as a link", "put this on JotBird", "update my JotBird doc/page", or wants Markdown content turned into a public URL. Also covers checking/updating page settings (theme, visibility, password) and listing or removing published JotBird documents.
---

# JotBird Publish

Publish Markdown content to JotBird and get back a shareable URL, via the JotBird HTTP API. Base URL: `https://www.jotbird.com`.

## Auth

Requires a Bearer API key. Set it as an env var before running any commands:

```bash
export JOTBIRD_API_KEY="jb_c57e765852df55f32daa0f8c745b3241552a052ddfbe1907f73a4d67d107fe4b"
```

Never hardcode the key in commands shown to the user or in output files — always reference `$JOTBIRD_API_KEY`.

## Publish a document

```bash
curl -s -X POST https://www.jotbird.com/api/v1/publish \
  -H "Authorization: Bearer $JOTBIRD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "markdown": "# Hello World\n\nContent here."
  }'
```

Optional fields in the JSON body:
- `title` — overrides the title extracted from the first `# H1`.
- `slug` — the slug of an **existing** document to update in place. Only works if that slug already belongs to the account; otherwise it's ignored and a new auto-generated slug is used.
- `namespaced: true` — publish at `share.jotbird.com/@username/slug` instead of a flat slug. Requires Pro + username set in Account Settings, and `slug` becomes required (not auto-generated).

Response (`201` new / `200` update):
```json
{
  "slug": "bright-calm-meadow",
  "username": null,
  "url": "https://share.jotbird.com/bright-calm-meadow",
  "title": "Hello World",
  "expiresAt": "2026-05-10T12:00:00.000Z",
  "ttlDays": 90,
  "created": true
}
```
Always read `slug`/`url` from the response — don't assume the slug you sent was used. Free accounts: 90-day expiry, 10 active docs, 10 publishes/hour. Pro: permanent links, unlimited docs, 100/hour.

To update a doc later, re-send with its known `slug`:
```bash
curl -s -X POST https://www.jotbird.com/api/v1/publish \
  -H "Authorization: Bearer $JOTBIRD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"markdown": "# Updated\n\nNew content.", "slug": "bright-calm-meadow"}'
```

Note: image uploads aren't supported — only externally-hosted image URLs render.

## List documents

```bash
curl -s https://www.jotbird.com/api/v1/documents \
  -H "Authorization: Bearer $JOTBIRD_API_KEY"
```
Returns all active documents with `slug`, `username`, `title`, `url`, `source` (`cli`/`web`/`api`), `updatedAt`, `expiresAt`, plus current page settings (`theme`, `hideBranding`, `visibility`, `tags`).

## Page settings (theme / visibility / password)

Read:
```bash
curl -s https://www.jotbird.com/api/v1/documents/<slug>/settings \
  -H "Authorization: Bearer $JOTBIRD_API_KEY"
```

Update (send only fields to change):
```bash
curl -s -X PATCH https://www.jotbird.com/api/v1/documents/<slug>/settings \
  -H "Authorization: Bearer $JOTBIRD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"theme": "essay", "visibility": "public"}'
```
- `theme`: `default` | `minimal` | `essay` | `terminal` (non-default requires Pro)
- `hideBranding`: bool (enabling requires Pro)
- `visibility`: `unlisted` | `public` | `password` (`password` requires Pro; must include `password` field when setting this)
- For `@username/slug` docs, add `?namespaced=true` to the URL.
- Turning password protection **on** applies immediately; relaxing it (`public`/`unlisted`) can take up to ~1 minute to reach the live page (the API/GET response is authoritative immediately).

## Remove a document

```bash
curl -s -X DELETE "https://www.jotbird.com/api/v1/documents?slug=<slug>" \
  -H "Authorization: Bearer $JOTBIRD_API_KEY"
```
Add `&namespaced=true` for `@username/slug` docs. This is permanent — confirm with the user before running it.

## Errors to watch for

| Code | Meaning | Typical cause |
|------|---------|----------------|
| 400 | Bad Request | missing `markdown`, bad slug format |
| 401 | Unauthorized | missing/invalid API key |
| 403 | Forbidden | not your document, or free-tier 10-doc cap reached |
| 429 | Rate limited | check `Retry-After` header |
| 413 | Payload too large | rendered HTML > 512 KB |
| 503 | Service unavailable | retry later |

## Workflow

1. Confirm the Markdown content/file to publish.
2. Check if this is a first-time publish or an update to a known `slug` (ask the user if unclear, or check prior conversation for a saved slug/URL).
3. Run the `curl` command with `$JOTBIRD_API_KEY` set.
4. Report back the returned `url` (and `slug` — worth saving if they'll want to update it later) plus expiry info if on a free account.
5. If the user wants a custom look, offer page settings (theme/visibility/password) as a follow-up, not by default.