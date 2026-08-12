/**
 * Next.js instrumentation hook. `register()` runs once per server process
 * before any request is handled. The Node-only SDK is imported dynamically so
 * the (edge-incompatible) NodeSDK never gets bundled into an edge runtime.
 *
 * Telemetry is opt-in: without OTEL_EXPORTER_OTLP_ENDPOINT (or the individual
 * traces/logs endpoint vars) the SDK is never constructed and the app behaves
 * exactly as before.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation.node");
  }
}
