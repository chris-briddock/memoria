import "server-only";
import { context, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

/**
 * Structured logging that feeds the export pipeline set up in
 * instrumentation.node.ts. When OTEL_EXPORTER_OTLP_LOGS_ENDPOINT (or the
 * generic endpoint var) is set, records are batched to the OTLP collector
 * with trace/span context attached, so a log line can be correlated with the
 * exact request that produced it. The same record always goes to stdout too,
 * so nothing is lost if the exporter is down or locally absent.
 *
 * Import one logger per module with a short, stable name:
 *
 *   const log = logger("storage");
 *   log.error("replica put failed", err, { key });
 */

type Fields = Record<string, string | number | boolean | null | undefined>;

type Level = "debug" | "info" | "warn" | "error";

const SEVERITY: Record<Level, SeverityNumber> = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

const CONSOLE: Record<Level, (msg: string, ...rest: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function errorFields(err: unknown): Fields {
  if (err instanceof Error) {
    return { "error.name": err.name, "error.message": err.message, "error.stack": err.stack };
  }
  return { "error.message": String(err) };
}

export type Log = {
  [K in Level]: (message: string, fields?: Fields, err?: unknown) => void;
};

export function logger(name: string): Log {
  const otelLogger = logs.getLogger(name);

  function emit(level: Level, message: string, fields: Fields = {}, err?: unknown) {
    const attrs: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries({ ...fields, ...(err ? errorFields(err) : {}) })) {
      if (v !== undefined && v !== null) attrs[k] = v;
    }

    // Attach the active span's ids explicitly so the record stays correlated
    // even with backends that don't infer log/trace links from context.
    const span = trace.getSpan(context.active());
    const spanCtx = span?.spanContext();
    otelLogger.emit({
      severityNumber: SEVERITY[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: attrs,
      context: context.active(),
      ...(spanCtx ? { traceId: spanCtx.traceId, spanId: spanCtx.spanId } : {}),
    });

    CONSOLE[level](`[${name}] ${message}`, err ?? "", Object.keys(attrs).length ? attrs : "");
  }

  return {
    debug: (message, fields, err) => emit("debug", message, fields, err),
    info: (message, fields, err) => emit("info", message, fields, err),
    warn: (message, fields, err) => emit("warn", message, fields, err),
    error: (message, fields, err) => emit("error", message, fields, err),
  };
}
