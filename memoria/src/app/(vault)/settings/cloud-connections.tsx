"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSubmit } from "@/lib/api-submit";

export type CloudConnectionStatus = {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
};

function DisconnectButton({ id, label }: Readonly<{ id: string; label: string }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${label}? You can reconnect at any time.`)) return;
    setPending(true);
    setError(null);
    const result = await apiSubmit(`/api/import?provider=${id}`, { method: "DELETE" });
    setPending(false);
    if (!result.ok) setError(result.error ?? "Could not disconnect.");
    else router.refresh();
  }

  return (
    <span className="flex items-center gap-3">
      {error && (
        <span role="alert" className="text-xs text-accent">
          {error}
        </span>
      )}
      <button
        type="button"
        className="btn-ghost text-sm"
        disabled={pending}
        onClick={handleDisconnect}
      >
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
    </span>
  );
}

/**
 * Cloud storage connections used by /import. Connecting is navigation-based
 * (a link through /api/import/connect) because the provider redirect must be
 * followed by the browser; disconnecting is a JSON DELETE.
 */
export function CloudConnections({
  connections,
}: Readonly<{ connections: CloudConnectionStatus[] }>) {
  if (connections.every((c) => !c.configured)) {
    return (
      <p className="card px-5 py-4 text-sm text-ink-soft">
        No cloud providers are configured on this server. Set the{" "}
        <code className="text-xs">IMPORT_GOOGLE_CLIENT_*</code> or{" "}
        <code className="text-xs">IMPORT_MICROSOFT_CLIENT_*</code> environment
        variables to enable imports from Google Drive or OneDrive.
      </p>
    );
  }

  return (
    <ul className="card divide-y divide-line">
      {connections
        .filter((c) => c.configured)
        .map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-5 py-3.5">
            <p className="text-sm font-medium">{c.label}</p>
            <span className="text-xs text-ink-faint">
              {c.connected ? "Connected" : "Not connected"}
            </span>
            <span className="ml-auto">
              {c.connected ? (
                <DisconnectButton id={c.id} label={c.label} />
              ) : (
                <Link href={`/api/import/connect/${c.id}`} className="btn-ghost text-sm">
                  Connect
                </Link>
              )}
            </span>
          </li>
        ))}
    </ul>
  );
}
