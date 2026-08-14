---
name: structured-logging
description: Inject high-value structured logging while writing or refactoring code. Use whenever generating, editing, or reviewing backend/service code (APIs, handlers, jobs, scripts) so errors are always caught and logged, and other important logging is added based on real risk of failure — not sprinkled everywhere. Trigger on requests like "add logging", "write this endpoint/handler/function", "refactor this service", or any code that talks to a DB, external API, queue, or has business logic with branching.
---

# Structured Logging Skill

Two tiers. Tier 1 is non-negotiable. Tier 2 requires judgment. Rule 0 overrides both.

## Rule 0 — Follow the project first, always

Before adding any log, check the codebase: existing logger (Winston/Pino,
structlog/loguru, Serilog/zap…)? Existing field naming (`user_id` vs
`userId`)? Existing redaction/PII-scrubbing utility? Existing audit-log
pipeline (e.g. a dedicated `audit_logs` table/service instead of stdout)?
**If the project already has a pattern for something below, use it — it wins
over every default in this skill.** Only apply the defaults below on a new
project, or where the project has no established pattern yet. Never rename an
established field (`status_code` → `statusCode`); reuse it.

**Preserve the pipeline:** never bypass, replace, or wrap existing logging
infrastructure — transports, formatters, tracing integrations, audit
pipelines. Don't `JSON.stringify()` into a logger that already accepts
structured objects, don't introduce a second logger, don't fall back to
`console.log`/`print`/`fmt.Println` "just this once."

This skill covers backend/service code (APIs, jobs, workers). Client-side/UI
logging is out of scope.

## Tier 1 — Mandatory: catch and log every exception

- Every exception that can occur MUST be caught (locally, or at a global
  unhandled-exception boundary) and logged. Never let it disappear silently or
  be re-thrown without a log.
- Exception log must include: `op` (operation/function name), `error`
  (`message`, `type`, `stack`), `correlation_id`, and a `state_dump` of the
  key variables present at failure time — redacted per the **internal-state**
  rule below (blocklist + auto-mask), not the external-input allowlist. The
  goal: explain *why* it failed, not just *that* it failed.
- Level: `ERROR` for unhandled/system failures (5xx, DB/queue down, panics).
  `WARN` for expected/recoverable failures (validation errors, 4xx,
  failed-then-retried). Never log expected user-input errors as `ERROR` — it
  drowns real alerts.
- This tier applies everywhere, always. No judgment call needed.

## Tier 2 — Judgment-based: log what could actually cause hard-to-find bugs

Categories below are *hints about where risk tends to live*, not a checklist
to log every instance of. **Before adding a non-error log line, ask:** *"If
this specific piece of code produces a wrong result, will I need this log
line to figure out why?"* Only add it if the honest answer is yes.

Lean toward logging: untrusted/unvalidated input, logic that can silently
produce a *wrong* result without throwing, non-trivial multi-condition
branching, an external call that can fail/be slow, irreversible or costly side
effects (money, hard-to-undo state changes).

Lean toward not logging: getters/setters/simple mappers, a branch so simple
the code already makes it obvious, per-iteration logging inside a loop.

When you do log, capture decision-relevant values, not the fact code ran
(`branch="loyalty_bonus", discount=15` not `"entering calculateDiscount"`);
for state mutations, capture before → after → trigger.

**Loop policy:** never log `INFO`/`DEBUG` per iteration. `WARN`/`ERROR` per
item IS allowed when that item has its own try/catch and needs independent
investigation (e.g. batch import). Always end the loop with one summary log
(`total_processed`, `total_failed`, up to 5 `sample_failed_ids`).

**Audit vs operational:** business actions with legal/compliance weight
(money moved, permission changed, record deleted, admin action) are **audit
events** — emit immediately, `INFO`/`WARN`, never sampled, never truncated
beyond secret-masking. Everything else is operational and may be sampled/
truncated/batched into a wide event as below.

**Self-check on log count, not a hard cap:** if a function ends up with more
than ~5 log lines, stop and re-justify each one against the question above —
don't cut a legitimately-needed log just to hit a number, and don't keep a
weak one just because you're under budget.

## How to log (mechanics)

- **Correlation & trace propagation**: if OpenTelemetry/APM context already
  exists (`trace_id`/`span_id`), **reuse it** — don't create a parallel
  `correlation_id`. Otherwise extract in priority order: W3C `traceparent` →
  `X-Request-ID`/`X-Correlation-ID` header → generate a UUID. Every entry
  point (HTTP middleware, queue consumer, cron/CLI main) sets this once and
  passes it through the whole call chain, including outgoing HTTP/DB/queue
  calls.
- **Structured, not string-concatenated**: one JSON object per line, fixed
  field names (project convention, default `snake_case`).
- **Emit timing**: normal successful flow accumulates into one "wide event" at
  exit. Errors, irreversible state changes, audit events, and failed external
  calls emit **immediately** with everything accumulated so far — don't wait,
  the process may crash first.
- **Streaming / long-lived connections** (WebSocket, SSE, gRPC stream):
  "wide event at exit" doesn't apply — a connection can live for hours. Emit
  `connected` at start and `disconnected` at end; WARN/ERROR **immediately**
  per message/segment failure; keepalive = metric, not log. Full pattern in
  `reference/domain-specific.md`.
- **Redaction — hybrid, not one rule for everything:**
  - External input / request payload / user-facing data → **allowlist**
    (default to not logging; explicitly list safe fields).
  - Internal state / exception context / local variables at crash time →
    **blocklist + auto-mask** (`password|token|secret|authorization|
    credit_card|ssn|api_key|private_key|otp|pin`, case-insensitive) +
    truncate strings > ~400 chars with `original_length`. This is what makes
    Tier 1's `state_dump` useful instead of empty.
  - Never dump a whole object (`logger.info(user)`) — extract fields.
- **Collections**: log `count` + ≤5 sample ids, never the full array.
- **Logger must be injectable** (parameter/DI), not a hardcoded global, so
  tests can swap in a no-op logger.
- **Performance-critical path** (marked `# performance-critical`): only
  `ERROR` + minimal fields.
- **High-frequency INFO** (health checks, polling): respect a configurable
  sampling rate — 100% of WARN/ERROR/audit, sampled success.
- **Metrics vs logging**: high-frequency numeric/boolean observations (cache
  hit/miss, queue depth, heartbeat, per-request counters) belong in
  **metrics**, not logs — unless folded as one field into a single wide event
  already being emitted. Logging these at high frequency is a common way AI
  silently 10x's log volume.
- **Non-blocking**: logging must never block the hot path — serialize/truncate
  large `state_dump` before emission.
- **High-cardinality**: don't use raw URLs with ids, full emails, filenames,
  prompts, or UUIDs as index/search labels — see
  `reference/field-dictionary.md` for the rule and safe alternatives.
- **Targeted debug** (optional): prefer enabling `DEBUG` only for a specific
  `correlation_id`/`user_id` allow-list rather than globally in production.
- **Business events**: name `domain.entity.action` (`order.payment.completed`);
  add a short human-readable `msg` field so logs stay skimmable by eye.
- **Output**: single-line JSON to stdout (stderr for ERROR). Append
  ERROR/FATAL to `logs.err.txt` **only** when `LOG_TO_FILE=true` (local
  non-containerized dev) — never a hard requirement.
- **Domain-specific fields** (LLM calls, idempotency keys, retry/backoff,
  transaction boundaries, feature flags, concurrency ids): see
  `reference/domain-specific.md` — don't inline these into every function by
  default, apply only when that domain is actually in play.

## Self-check before finishing a function

- [ ] Every possible exception path is caught and logged with `state_dump`
      (blocklist-redacted, not allowlist).
- [ ] Every non-error log I added — could I explain in one sentence what
      failure it would help diagnose? If not, remove it.
- [ ] No `INFO`/`DEBUG` inside a loop body; per-item `WARN`/`ERROR` only if
      justified, plus a summary line after the loop.
- [ ] Audit events (money/permission/delete/admin) emitted immediately, not
      sampled or truncated.
- [ ] No secrets/PII logged; external input uses allowlist, internal state
      uses blocklist + auto-mask.
- [ ] Field names match the project's existing convention (Rule 0).
- [ ] Reused existing OpenTelemetry/trace context instead of inventing a
      parallel `correlation_id`?
- [ ] High-frequency counters/booleans logged as metrics, not log lines?
- [ ] Could someone else debug a real failure here using only these logs,
      without a debugger?

## Review Mode (auditing existing code / a PR, not generating new code)

Same tiers and checks above apply, plus specifically look for:

- [ ] A bypassed pipeline: `console.log`/`print`/`fmt.Println`, a second
      logger instance, or `JSON.stringify()` into a structured-capable logger.
- [ ] A new `correlation_id` created where OpenTelemetry/trace context was
      already available and should have been reused instead.
- [ ] High-cardinality values used as indexed/searchable labels.