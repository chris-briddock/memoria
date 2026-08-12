/**
 * Node-only OpenTelemetry setup. Imported from instrumentation.ts only when
 * NEXT_RUNTIME === "nodejs", so nothing here is ever evaluated in an edge
 * bundle.
 *
 * Endpoint resolution, per OTel spec:
 *   - OTEL_EXPORTER_OTLP_TRACES_ENDPOINT / OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
 *     are used verbatim (must include the /v1/... path).
 *   - Otherwise OTEL_EXPORTER_OTLP_ENDPOINT + "/v1/traces" (or "/v1/logs").
 *   - Unset entirely -> no SDK, no export; the app runs as before.
 *
 * OTEL_EXPORTER_OTLP_HEADERS ("key=value,key2=value2") is honoured by the
 * exporters themselves for auth tokens (e.g. Axiom's xaat-...).
 */
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

function resolveEndpoint(kind: "traces" | "logs"): string | undefined {
  const specific = process.env[`OTEL_EXPORTER_OTLP_${kind.toUpperCase()}_ENDPOINT`];
  if (specific) return specific;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return base ? `${base.replace(/\/$/, "")}/v1/${kind}` : undefined;
}

const tracesEndpoint = resolveEndpoint("traces");
const logsEndpoint = resolveEndpoint("logs");

if (tracesEndpoint || logsEndpoint) {
  // An empty string is set-but-invalid: it would hide every log/span from the
  // resource filter in Aspire, since it indexes by service.name.
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "memoria";
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "unknown",
    "deployment.environment.name":
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  });

  const sdk = new NodeSDK({
    resource,
    spanProcessor: tracesEndpoint
      ? new BatchSpanProcessor(new OTLPTraceExporter({ url: tracesEndpoint }))
      : undefined,
    logRecordProcessors: logsEndpoint
      ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: logsEndpoint }) })]
      : [],
  });
  sdk.start();

  // Batch processors need a flush on shutdown or the tail of a deploy/crash
  // silently drops the last buffer of spans and log records.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      sdk
        .shutdown()
        .catch(() => {})
        .finally(() => process.kill(process.pid, signal));
    });
  }
}
