import { NextResponse } from "next/server";
import { getVaultStats } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await getVaultStats();
  return NextResponse.json(stats);
}
