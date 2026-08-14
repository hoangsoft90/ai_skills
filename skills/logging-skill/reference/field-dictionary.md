# Field Dictionary (Log Stability)

`snake_case` by default. **Once a field is used, never rename it without an explicit migration** —
`user_id` → `uid` or `userId` breaks ELK/Loki queries and dashboards.

Before adding a new field: grep the codebase. If a field already means the same thing, reuse it.
Add new project-specific fields here as they appear so future sessions reuse them instead of inventing names.

## Core (every log line)

| Field | Type | Meaning |
|---|---|---|
| `timestamp` | ISO8601 UTC | when |
| `correlation_id` | string | request/job/operation id |
| `level` | debug/info/warn/error/fatal | severity |
| `msg` | string | short human-readable summary |
| `op` | string | operation name (`domain.action`, e.g. `auth.login`) |

## Tier 1 — exception log

| Field | Type | Meaning |
|---|---|---|
| `error.message` | string | error text |
| `error.type` | string | exception/error class |
| `error.stack` | string | stack trace |
| `state_dump` | object | blocklist-redacted state at failure time |

## Core infrastructure / service identity

Add these when logs are collected centrally across services (K8s, serverless,
microservices) — without them a `correlation_id` can't be traced to a service.

| Field | Type | Meaning |
|---|---|---|
| `service_name` | string | microservice/app name (`auth-service`) |
| `component` | string | sub-component (`payment-worker`, `api-gateway`) |
| `trace_id` / `span_id` | string | present when OpenTelemetry/APM is configured — use these instead of a separate `correlation_id` when available |
| `host` | string | pod/hostname (usually added by the collector; include only if the collector doesn't) |

## Tier 2 — operational log

| Field | Type | Meaning |
|---|---|---|
| `status_code` | int | HTTP status |
| `duration_ms` | number | elapsed |
| `method` | string | HTTP method |
| `path` | string | raw request path as received (`/api/v1/orders/12345`) — exact-match search only, not for aggregation |
| `route` | string | **parameterized** route template (`/api/v1/orders/:id`) — preferred for aggregation; never log real ids here |
| `client_ip` | string | originating IP, respect `X-Forwarded-For` |
| `user_agent` | string | truncate if > 200 chars |
| `user_id` | string | actor |

## High-cardinality rule

To avoid index explosion in Loki/Elasticsearch/Datadog, never use as an
indexed/searchable label: a raw URL with real path params (`/users/12345`),
a full email, a filename, a full prompt/response body, a UUID as a label
value, or a raw dynamic query string.

Prefer: parameterized route (`/users/:id`), a hash of the value, or put the
raw/dynamic value inside an unindexed payload field instead of a label.

## Business events

| Field | Type | Meaning |
|---|---|---|
| `event` | string | `domain.entity.action` (`order.payment.completed`) |
| `before` / `after` / `trigger` | any | state mutation |

**Naming convention**: always `domain.entity.action`. Before inventing a new
event name, grep for an existing one that means the same thing — don't create
synonyms (`payment.success` vs `payment.completed` vs `payment.complete` are
the same event; pick one and reuse it everywhere).

## Audit (money / permission / delete / admin)

| Field | Type | Meaning |
|---|---|---|
| `actor_id` | string | who |
| `action` | string | what (`permission.granted`) |
| `target_id` | string | on what |
| `outcome` | success/denied/failed | result |

## Domain-specific → see `domain-specific.md`

- LLM: `provider`, `model`, `*_tokens`, `finish_reason`
- Idempotency: `idempotency_key`, `duplicate`
- Retry: `retry_count`, `max_retry`, `backoff_ms`
- Transaction: `transaction_id`, `rollback_reason`
- Feature flag: `feature_flag`, `variant`, `enabled`
- Concurrency: `worker_id`, `thread_id`, `task_id`

## Redaction

Sensitive keys auto-masked (case-insensitive):
`password|token|secret|authorization|credit_card|ssn|api_key|private_key|otp|pin`

Add project-specific sensitive fields here (e.g. `bank_account`, `medical_id`, `ssn`) as they appear —
allowlist for external input, blocklist + auto-mask for internal state.