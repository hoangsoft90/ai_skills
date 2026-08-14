# Domain-Specific Logging Fields

Apply ONLY when the domain is in play — do not inline these into every function.
Tier 1/2 and Rule 0 still govern; these extend the field vocabulary, never replace it.
`SKILL.md` points here; load this file when the code you are writing touches one of these domains.

## LLM / AI calls

Every external LLM call:
`provider`, `model`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `latency_ms`, `finish_reason`, `cached`

```
provider="anthropic", model="claude-sonnet-5", prompt_tokens=420, completion_tokens=91, latency_ms=812, finish_reason="end_turn"
```

Why: cost + performance + failure diagnosis. Without token/latency you are blind to spend and slowness.

## Idempotency (webhooks, retry queues, payment callbacks)

On dedup hit:
`duplicate=true`, `idempotency_key`, `original_request` (id/summary)

```
duplicate=true, idempotency_key="pay_123", original_request_id="req_456"
```

Why: "already processed" bugs fail silently and are among the hardest to find.

## Retry / backoff

On a retry attempt:
`retry_count`, `max_retry`, `backoff_ms`, `reason`

```
retry=2, max_retry=3, backoff_ms=2000, reason="timeout"
```

Level: `WARN` (recoverable, expected).

## Transaction boundaries (DB)

On BEGIN / COMMIT / ROLLBACK of a business transaction:
`transaction_id`, `operation`, `rollback_reason`, `affected_records`

Emit on rollback immediately — a failed transaction is an irreversible-ish event you must not lose.

## Feature flags / A/B / experiment

`feature_flag`, `variant`, `enabled`

```
feature_flag="checkout_v2", variant="A", enabled=true
```

## Concurrency (workers, threads, coroutines)

`worker_id`, `thread_id`, `task_id` — especially BullMQ/Celery/AsyncIO/goroutines.

Why: parallel failures can only be grouped and diagnosed by executor id.

## Outbound HTTP / third-party API calls

Every outbound call to an external dependency (payment gateway, SMS, OAuth
provider, another microservice):
`target_service`, `http_method`, `target_url`, `response_status`,
`latency_ms`, `attempt`

```
target_service="stripe", http_method="POST", target_url="https://api.stripe.com/v1/charges",
response_status=200, latency_ms=342, attempt=1
```

Always strip query params and Authorization headers/tokens from `target_url`
before logging.

## Cache (Redis / Memcached / in-memory / CDN)

`cache_system`, `op` (get/set/del), `result` (hit/miss/stale), `key_hash`,
`ttl_ms`

Log individual cache operations sparingly (Tier 2 judgment); a hit/miss
counter belongs in **metrics**, not a log line per operation — see
`SKILL.md` "Metrics vs logging". Log when a cache failure changes program
behavior (fallback to source, stale data served).

## Message queue / async workers (Kafka, RabbitMQ, BullMQ, SQS, NATS)

`queue_system`, `topic`/`queue_name`, `partition`, `offset`,
`delivery_count`, `delay_ms`

Use `delivery_count` to distinguish a first attempt from a redelivery — a
message on its 5th redelivery is a different debugging story than a fresh one.

## Database slow queries

For queries exceeding a threshold (e.g. > 200ms), not for every query:
`db_system`, `table`, `operation` (select/update/...), `duration_ms`,
`rows_affected`, `query_id`

Never log the full raw SQL with unbound parameter values (secrets/PII risk +
high cardinality). Log a `query_id`/name that maps back to the query in code.

## Resilience: circuit breaker / rate limiter / bulkhead

When a protective mechanism blocks or reroutes execution:
`circuit_breaker_state` (closed/open/half-open), `rate_limit_remaining`,
`bulkhead_available`, `fallback_executed`

```
circuit_breaker_state="open", reason="db_timeout_5_consecutive", fallback_executed=true, op="order.create"
```

Why this matters: without `circuit_breaker_state`, an ERROR log during an
open-circuit period looks identical to a fresh failure, and engineers chase
the wrong root cause (e.g. optimizing the DB when the real issue is the
breaker hasn't reset).

## Streaming / long-lived connections (WebSocket, SSE, gRPC streams)

"Emit one wide event at exit" doesn't apply — a connection can live for
hours. Instead:
- Emit a `connected` event at start and `disconnected` at end (with total
  `duration_ms`).
- Emit `WARN`/`ERROR` **immediately** for each message/segment failure — do
  not wait for disconnect.
- A keepalive/heartbeat is a **metric** (counter), not a log — unless it
  fails, then log `WARN`.
- Maintain a mutable `stream_context` (last known state) and attach it to any
  stream error log, since there is no single "request" to accumulate into.

## Audit fields (already in SKILL.md core — money/permission/delete/admin)

Emit immediately, no sampling, no truncation beyond secret-masking.

`actor_id`, `action`, `target_id`, `outcome`