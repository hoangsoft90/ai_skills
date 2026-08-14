# C# / ASP.NET Core — Structured Logging Reference

Apply alongside `SKILL.md`. Uses `Microsoft.Extensions.Logging` (`ILogger<T>`, DI-injectable by
default) with structured message templates; Serilog is a drop-in alternative if the project already
uses it. Rule 0: if the project already has Serilog sinks/enrichers configured, reuse them.

## Middleware: correlation_id + wide-event summary

```csharp
public class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggingMiddleware> _log;

    public RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> log)
        => (_next, _log) = (next, log);

    public async Task InvokeAsync(HttpContext ctx)
    {
        // Reuse the current OpenTelemetry/System.Diagnostics Activity if one exists —
        // don't mint a parallel correlation_id when a trace is already active.
        var correlationId = Activity.Current?.TraceId.ToString()
            ?? ctx.Request.Headers["X-Request-ID"].FirstOrDefault()
            ?? Guid.NewGuid().ToString();
        ctx.Response.Headers["X-Request-ID"] = correlationId;

        using (_log.BeginScope(new Dictionary<string, object> { ["correlation_id"] = correlationId }))
        {
            var sw = Stopwatch.StartNew();
            await _next(ctx);
            sw.Stop();

            // Operational summary — sample high-frequency success, 100% of 4xx+
            if (ctx.Response.StatusCode >= 400 || Sampler.ShouldLog())
            {
                _log.LogInformation(
                    "request completed {Method} {Route} {StatusCode} {DurationMs}",
                    ctx.Request.Method,
                    ctx.GetEndpoint()?.DisplayName ?? ctx.Request.Path, // prefer route template over raw path
                    ctx.Response.StatusCode,
                    sw.ElapsedMilliseconds);
            }
        }
    }
}
```

## Tier 1 — exception handling middleware, emit immediately

```csharp
// .NET 8+: register via builder.Services.AddExceptionHandler<UnhandledExceptionHandler>();
public class UnhandledExceptionHandler : IExceptionHandler
{
    private readonly ILogger<UnhandledExceptionHandler> _log;
    public UnhandledExceptionHandler(ILogger<UnhandledExceptionHandler> log) => _log = log;

    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        var isExpected = ex is ValidationException or ArgumentException;   // expected → WARN
        var stateDump = Redact.Mask(RequestSnapshot(ctx));                  // blocklist-redacted

        if (isExpected)
        {
            _log.LogWarning(ex, "request rejected {Op} {StateDump}", "http.validation", stateDump);
            ctx.Response.StatusCode = 400;
        }
        else
        {
            _log.LogError(ex, "unhandled failure {Op} {StateDump}", "http.unhandled", stateDump);
            ctx.Response.StatusCode = 500;
        }
        await ctx.Response.WriteAsJsonAsync(new { error = "request failed" }, ct);
        return true;
    }
}
```

## Hybrid redact

```csharp
public static class Redact
{
    private static readonly Regex Sensitive = new(
        @"(password|token|secret|authorization|credit_card|ssn|api_key|private_key|otp|pin)",
        RegexOptions.IgnoreCase);

    public static object? Mask(object? v) => v switch
    {
        string s when s.Length > 400 =>
            new { value = s[..400] + "...[truncated]", original_length = s.Length },
        string s => s,
        IEnumerable<object> list =>
            new { item_count = list.Count(), sample_ids = list.Take(5) },
        IDictionary<string, object> dict =>
            dict.ToDictionary(kv => kv.Key, kv => Sensitive.IsMatch(kv.Key) ? "[REDACTED]" : Mask(kv.Value)),
        _ => v
    };
}

// External input → allowlist (never log the whole request DTO)
static object AllowlistInput(LoginRequest body) => new { user_id = body.UserId, email = body.Email };
```

## Logger injectable (testable)

```csharp
public class OrderService
{
    private readonly ILogger<OrderService> _log;   // ILogger<T> is DI-injectable by default in ASP.NET Core

    public OrderService(ILogger<OrderService> log) => _log = log;
}
// In tests: inject a `NullLogger<OrderService>.Instance` — no I/O, no assertions on log text needed
// unless the test specifically verifies logging behavior.
```

## Notes

- Use structured message templates (`_log.LogInformation("order {OrderId} shipped", orderId)`), never
  string interpolation (`$"order {orderId} shipped"`) — interpolation defeats structured field
  extraction by the logging provider.
- `Console.WriteLine` / `Debug.WriteLine` are never acceptable in business code.
- If `System.Diagnostics.Activity` / OpenTelemetry (`AddOpenTelemetry().WithTracing(...)`) is
  configured, `Activity.Current.TraceId`/`SpanId` are the trace context — reuse them as
  `correlation_id`, don't mint a new GUID (see middleware above).
- `ILogger<T>.BeginScope` is the idiomatic way to attach `correlation_id` to every log line for the
  duration of a request without passing a context object explicitly through every method signature.
- Business events: `op`/event name = `domain.action` (e.g. `order.payment.completed`); include a
  human-readable message for skimmability.
- Loop policy: no per-iteration `LogInformation`/`LogDebug`; per-item `LogWarning`/`LogError` allowed
  with its own try/catch; one summary log line after the loop.