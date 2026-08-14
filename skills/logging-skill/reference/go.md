# Go — Structured Logging Reference

Apply alongside `SKILL.md`. Uses stdlib `log/slog` (Go 1.21+). Rule 0: reuse the project's existing
logger/handler if it is not `slog` — adapt, don't fork a second logging system.

## Middleware: correlation_id + wide-event summary

```go
func WithRequestLog(log *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            corrID := r.Header.Get("X-Request-ID")
            if corrID == "" {
                corrID = uuid.NewString()
            }
            w.Header().Set("X-Request-ID", corrID)
            start := time.Now()
            rw := &statusRecorder{ResponseWriter: w}
            ctx := context.WithValue(r.Context(), logCtxKey{}, log.With("correlation_id", corrID))
            next.ServeHTTP(rw, r.WithContext(ctx))
            dur := time.Since(start)
            if rw.status >= 400 || sample() {   // sample high-frequency success
                log.Info("request completed", "method", r.Method, "path", r.URL.Path, // prefer "route" (parameterized template) if your router exposes it
                    "status_code", rw.status, "duration_ms", dur.Milliseconds())
            }
        })
    }
}
```

## Tier 1 — recover middleware (catch panics) + error path, emit immediately

```go
func Recoverer(log *slog.Logger) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            defer func() {
                if rec := recover(); rec != nil {
                    log.Error("unhandled panic",
                        "op", "http.unhandled",
                        "error", fmt.Sprintf("%v", rec),
                        "stack", string(debug.Stack()),
                        "state_dump", Redact(stateSnapshot(r)))   // blocklist-redacted
                    http.Error(w, "internal error", http.StatusInternalServerError)
                }
            }()
            next.ServeHTTP(w, r)
        })
    }
}

// expected business failures → WARN; system failures → ERROR
func WriteErr(w http.ResponseWriter, r *http.Request, log *slog.Logger, op string, status int, reason string) {
    level := slog.LevelWarn
    if status >= 500 {
        level = slog.LevelError
    }
    slog.Log(r.Context(), level, op+" "+reason, "status_code", status)
    http.Error(w, reason, status)
}

// context.Canceled / DeadlineExceeded are expected (client disconnected, or a
// deployment/k8s rollout killed the pod) — WARN, not ERROR. Logging these as
// ERROR causes false alarms on routine deploys/rollouts.
func LogOpError(log *slog.Logger, op string, err error) {
    if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
        log.Warn("operation canceled or timed out", "op", op, "error", err.Error())
        return
    }
    log.Error("operation failed", "op", op, "error", err.Error())
}
```

## Hybrid redact

```go
var sensitive = regexp.MustCompile(`(?i)(password|token|secret|authorization|credit_card|ssn|api_key|private_key|otp|pin)`)

func Redact(v any) any {
    switch t := v.(type) {
    case string:
        if len(t) > 400 {
            return map[string]any{"value": t[:400] + "...[truncated]", "original_length": len(t)}
        }
        return t
    case []any:
        return map[string]any{"item_count": len(t), "sample_ids": t[:min(5, len(t))]}
    case map[string]any:
        out := make(map[string]any, len(t))
        for k, x := range t {
            if sensitive.MatchString(k) {
                out[k] = "[REDACTED]"
            } else {
                out[k] = Redact(x)
            }
        }
        return out
    default:
        return v
    }
}
```

## Logger injectable (testable)

```go
// pass *slog.Logger as a field/param; in tests:
//   slog.New(slog.NewTextHandler(io.Discard, nil))  // no-op
type Service struct {
    Log *slog.Logger
}
```

## Notes

- Set JSON handler for stdout: `slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))`.
- No `fmt.Println` in business code — always through injected `slog.Logger`.
- Business events: `op` = `domain.action`; add `msg` for skimmability.
- Loop policy: no per-iteration INFO; per-item WARN/ERROR allowed with own error handling; summary after loop.