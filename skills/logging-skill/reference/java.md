# Java / Spring Boot — Structured Logging Reference

Apply alongside `SKILL.md`. Uses SLF4J + Logback/`logstash-logback-encoder` for JSON output and MDC for
context propagation. Rule 0: if the project already uses a different stack (Log4j2, a custom JSON layout,
Micrometer Tracing), reuse it — adapt these patterns, don't fork a second logging system.

## Filter: correlation_id + MDC + wide-event summary

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLoggingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestLoggingFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        // Reuse OpenTelemetry trace context if Micrometer Tracing / otel-spring-boot-starter is on
        // the classpath — do NOT mint a parallel correlation_id when trace_id is already present.
        String correlationId = MDC.get("trace_id");
        if (correlationId == null) {
            correlationId = req.getHeader("X-Request-ID");
            if (correlationId == null) correlationId = UUID.randomUUID().toString();
        }
        MDC.put("correlation_id", correlationId);
        res.setHeader("X-Request-ID", correlationId);
        long start = System.nanoTime();
        try {
            chain.doFilter(req, res);
        } finally {
            long durationMs = (System.nanoTime() - start) / 1_000_000;
            // Operational summary — sample high-frequency success, 100% of 4xx+
            if (res.getStatus() >= 400 || Sampler.shouldLog()) {
                log.atInfo()
                    .addKeyValue("msg", "request completed")
                    .addKeyValue("method", req.getMethod())
                    .addKeyValue("route", routeTemplateOf(req))   // parameterized, not raw path
                    .addKeyValue("status_code", res.getStatus())
                    .addKeyValue("duration_ms", durationMs)
                    .log();
            }
            MDC.clear();   // prevent leaking context into the next request on a pooled thread
        }
    }
}
```

## Tier 1 — global exception handler, emit immediately

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ValidationException.class)   // expected → WARN
    public ResponseEntity<?> handleValidation(ValidationException e, HttpServletRequest req) {
        log.atWarn()
            .addKeyValue("op", "http.validation")
            .addKeyValue("error", Map.of("message", e.getMessage(), "type", e.getClass().getSimpleName()))
            .addKeyValue("status_code", 400)
            .log();
        return ResponseEntity.badRequest().body(Map.of("error", "invalid request"));
    }

    @ExceptionHandler(Exception.class)   // unhandled → ERROR, dump state, emit now
    public ResponseEntity<?> handleUnhandled(Exception e, HttpServletRequest req) {
        log.atError()
            .addKeyValue("op", "http.unhandled")
            .addKeyValue("error", Map.of(
                "message", e.getMessage(),
                "type", e.getClass().getName(),
                "stack", ExceptionUtils.getStackTrace(e)))
            .addKeyValue("state_dump", Redact.mask(requestSnapshot(req)))   // blocklist-redacted
            .log();
        return ResponseEntity.status(500).body(Map.of("error", "internal error"));
    }
}
```

## Hybrid redact

```java
public final class Redact {
    private static final Pattern SENSITIVE = Pattern.compile(
        "(?i)(password|token|secret|authorization|credit_card|ssn|api_key|private_key|otp|pin)");

    public static Object mask(Object v) {
        if (v instanceof String s) {
            return s.length() > 400
                ? Map.of("value", s.substring(0, 400) + "...[truncated]", "original_length", s.length())
                : s;
        }
        if (v instanceof Collection<?> c) {
            return Map.of("item_count", c.size(),
                "sample_ids", c.stream().limit(5).toList());
        }
        if (v instanceof Map<?, ?> m) {
            Map<Object, Object> out = new LinkedHashMap<>();
            m.forEach((k, val) -> out.put(k,
                SENSITIVE.matcher(String.valueOf(k)).find() ? "[REDACTED]" : mask(val)));
            return out;
        }
        return v;
    }
}

// External input → allowlist (never log the whole DTO/entity)
Map<String, Object> allowlistInput(LoginRequest body) {
    return Map.of("user_id", body.userId(), "email", body.email());
}
```

## Logger injectable (testable)

```java
@Service
public class OrderService {
    private final Logger log;   // constructor-injected, not a static field — swap in tests

    public OrderService(Logger log) {   // default to LoggerFactory.getLogger(OrderService.class) via a @Bean
        this.log = log;
    }
}
// In tests: pass a Logback NOPLogger or a captured ListAppender instead of the real sink.
```

## Notes

- Prefer `log.atInfo().addKeyValue(...)` (SLF4J 2.x fluent API) or a JSON encoder
  (`logstash-logback-encoder`) over string-concatenated messages.
- `System.out.println` / raw `e.printStackTrace()` are never acceptable in business code.
- If `micrometer-tracing` / `opentelemetry-spring-boot-starter` is present, `trace_id`/`span_id` are
  already in MDC — reuse them as `correlation_id`, don't mint a new UUID (see filter above).
- **Always `MDC.clear()`** in a `finally` block — Spring's thread pool reuses threads, and a forgotten
  MDC value leaks into an unrelated request.
- Business events: `op` = `domain.action` (e.g. `order.payment.completed`); add a `msg` key for
  skimmability.
- Loop policy: no per-iteration INFO; per-item WARN/ERROR allowed with its own try/catch; one summary
  log line after the loop.