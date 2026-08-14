# Python / FastAPI — Structured Logging Reference

Apply alongside `SKILL.md`. Tier 1 = mandatory exception logging, Tier 2 = risk-judgment.
Rule 0 first: reuse project's existing logger/fields (stdlib `logging` or `structlog`/`loguru`).

## Setup: correlation_id middleware + contextvar

```python
import contextvars, time, uuid
from datetime import datetime, timezone
from fastapi import Request

_current = contextvars.ContextVar("log", default=None)

def get_logger():
    return _current.get() or logging.getLogger("app")

@app.middleware("http")
async def request_logging(request: Request, call_next):
    logger = structlog.get_logger()  # or logging.getLogger("app") — Rule 0
    token = _current.set(logger.bind(
        correlation_id=request.headers.get("x-request-id") or str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
    ))
    start = time.perf_counter()
    try:
        response = await call_next(request)
    finally:
        duration_ms = (time.perf_counter() - start) * 1000
        route = request.scope["route"].path if "route" in request.scope else request.path
        if response.status_code >= 400 or sample_success():   # sample high-frequency
            logger.info("request completed", method=request.method,
                        route=route, status_code=response.status_code,
                        duration_ms=round(duration_ms, 1))
        _current.reset(token)
    return response
```

## Tier 1 — global exception handler: catch + log everything, emit immediately

```python
@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log = get_logger()
    log.error("unhandled failure",
              op="http.unhandled",
              error={"message": str(exc), "type": type(exc).__name__,
                     "stack": traceback.format_exc()},
              state_dump=redact(locals_snapshot()),   # blocklist-redacted, never allowlist
              msg="unhandled failure")
    if os.environ.get("LOG_TO_FILE") == "true":
        append_err_file(...)   # ERROR/FATAL → logs.err.txt, async, local dev only
    return JSONResponse(status_code=500, content={"error": "request failed"})
```

## Hybrid redact

```python
import re
SENSITIVE = re.compile(r"(password|token|secret|authorization|credit_card|ssn|api_key|private_key|otp|pin)", re.I)

def redact(v):
    if isinstance(v, str):
        return {"value": v[:400] + "...[truncated]", "original_length": len(v)} if len(v) > 400 else v
    if isinstance(v, (list, tuple)):
        return {"item_count": len(v), "sample_ids": v[:5]}
    if isinstance(v, dict):
        return {k: "[REDACTED]" if SENSITIVE.search(k) else redact(x) for k, x in v.items()}
    return v

def allowlist_input(body):   # external input → allowlist only
    return {"user_id": body.get("user_id"), "email": body.get("email"), "action": body.get("action")}
```

## Injectable logger via FastAPI dependency

```python
def get_log():
    return get_logger()   # swap for NullLogger in tests

@app.post("/api/login")
async def login(body: LoginBody, log=Depends(get_log)):
    try:
        user = await find_user(body.email)
        if not user or user.password != body.password:
            log.warning("login rejected", op="auth.login",  # expected → WARN, not ERROR
                        reason="invalid_credentials", status_code=401)
            raise HTTPException(401, "invalid credentials")
        log.info("login succeeded", op="auth.login", user_id=user.id, status_code=200)
        return {"token": create_token(user)}
    except HTTPException:
        raise
    except Exception as e:
        log.error("login failed", op="auth.login",  # unhandled → ERROR + state_dump
                  error={"message": str(e), "type": type(e).__name__, "stack": traceback.format_exc()},
                  state_dump=redact({"email": body.email}))
        raise
```

## Notes

- `structlog` recommended (`.bind()` accumulates context into a wide event). stdlib OK if project uses it.
- Prefer `structlog`'s own `structlog.contextvars` (`bind_contextvars`/
  `clear_contextvars` + `merge_contextvars` processor) over a hand-rolled
  `ContextVar` holding a bound logger — the hand-rolled version above is fine
  for simple cases but can leak context across concurrent tasks (e.g.
  `asyncio.gather`) if not reset carefully. If the project already uses
  `structlog`, use its native contextvars integration.
- Logger injectable via `Depends(get_log)` → tests use a no-op logger.
- No `print()` in business code.
- Business events: `op` = `domain.action`; add `msg` for skimmability.