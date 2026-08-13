import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { verifySession } from "@/lib/dal";
import {
  CLOUD_PROVIDERS,
  IMPORT_SURFACES,
  isCloudProviderEnabled,
} from "@/lib/import-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status of every import provider & surface for the signed-in user: which are
 * configured on the server and which the user has connected. The /import page
 * and the Settings section both render from this.
 */
export async function GET() {
  const user = await verifySession();

  const rows = await db.query.accounts.findMany({
    where: eq(accounts.userId, user.id),
  });
  const connectedIds = new Set(
    rows
      .filter((r) => CLOUD_PROVIDERS.some((p) => p.id === r.provider))
      .map((r) => r.provider),
  );

  return NextResponse.json({
    providers: CLOUD_PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      configured: isCloudProviderEnabled(p),
      connected: connectedIds.has(p.id),
    })),
    surfaces: IMPORT_SURFACES.map((s) => ({
      id: s.id,
      label: s.label,
      kind: s.kind,
      configured: isCloudProviderEnabled(s.provider),
      connected: connectedIds.has(s.provider.id),
    })),
  });
}

/** Disconnect: DELETE /api/import?provider=gdrive */
export async function DELETE(request: Request) {
  const user = await verifySession();
  const provider = new URL(request.url).searchParams.get("provider");
  const def = CLOUD_PROVIDERS.find((p) => p.id === provider);
  if (!def) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.provider, def.id)));
  return NextResponse.json({ ok: true });
}
