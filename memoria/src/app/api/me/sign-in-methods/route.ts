import { NextResponse } from "next/server";
import { listSignInMethods } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const methods = await listSignInMethods();
  return NextResponse.json(methods);
}
