# Node.js / Express — Structured Logging Reference

Apply alongside `SKILL.md`. Tier 1 = mandatory exception logging, Tier 2 = risk-judgment.
Rule 0 first: if the project already has Pino/Winston and field conventions, reuse them — only adapt these patterns.

## Middleware: correlation_id + timing + wide-event summary

```js
const crypto = require('crypto');

function requestLogger(log) {
  return (req, res, next) => {
    req.log = log.child({
      correlation_id: req.get('x-request-id') || crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    req.log.start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - req.log.start) / 1e6;
      // Operational summary — sample high-frequency success, 100% of 4xx+
      if (res.statusCode >= 400 || req.log.sample()) {
        req.log.info({
          msg: 'request completed',
          method: req.method,
          route: req.route?.path ?? req.path,   // parameterized template when available, raw fallback
          status_code: res.statusCode,
          duration_ms: Math.round(ms * 10) / 10,
        });
      }
    });
    // Client disconnected before the response finished — 'finish' won't fire
    // (or fires with a misleading status). Log it separately so aborted
    // requests aren't silently missing from the logs.
    res.on('close', () => {
      if (!res.writableEnded) {
        const ms = Number(process.hrtime.bigint() - req.log.start) / 1e6;
        req.log.warn({
          msg: 'request aborted by client',
          method: req.method,
          route: req.route?.path ?? req.path,   // parameterized template when available, raw fallback
          duration_ms: Math.round(ms * 10) / 10,
        });
      }
    });
    next();
  };
}
```

## Tier 1 — error middleware: catch + log everything uncaught, emit immediately

```js
app.use((err, req, res, next) => {
  const isExpected = err.status && err.status >= 400 && err.status < 500;
  const level = isExpected ? 'warn' : 'error';
  req.log[level]({
    op: 'http.unhandled',
    error: { message: err.message, type: err.name, stack: err.stack },
    state_dump: maskState(req.log.state),   // blocklist-redacted, never allowlist
    msg: 'unhandled failure',
  });
  if (process.env.LOG_TO_FILE === 'true' && level === 'error') {
    fs.appendFile('logs.err.txt', line + '\n', () => {});   // async, local dev only
  }
  res.status(isExpected ? err.status : 500).json({ error: 'request failed' });
});
```

## Hybrid redact helper

```js
const SENSITIVE = /(password|token|secret|authorization|credit_card|ssn|api_key|private_key|otp|pin)/i;

function mask(v) {
  if (typeof v === 'string') {
    return v.length > 400 ? { value: v.slice(0, 400) + '...[truncated]', original_length: v.length } : v;
  }
  if (Array.isArray(v)) return { item_count: v.length, sample_ids: v.slice(0, 5) };
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) =>
      SENSITIVE.test(k) ? [k, '[REDACTED]'] : [k, mask(x)]
    ));
  }
  return v;
}

// External input → allowlist (never log the whole body)
function allowlistInput(body) {
  return { user_id: body.user_id, email: body.email, action: body.action };
}
// Internal state / crash context → blocklist + auto-mask
const state_dump = mask({ stock_before, stock_after, trigger, order_id, cart_items });
```

## Logger injectable (testable)

```js
function createService(log = defaultLogger) {
  return { processOrder, log };
}
// in tests: new createService(new NullLogger())  — no log noise, no I/O
```

## Notes

- Successful flow → accumulate into one wide event, emit at exit. ERROR/audit/irreversible → emit immediately.
- No `console.log`/`print` in business code — always through the injectable `req.log`.
- Business events: `op` = `domain.action` (e.g. `auth.login`, `order.payment.completed`); add `msg` for skimmability.
- Loop policy: no per-iteration INFO; per-item WARN/ERROR allowed with own try/catch; summary line after loop.