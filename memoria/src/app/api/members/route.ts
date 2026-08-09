import { NextResponse } from "next/server";
import { verifySession } from "@/lib/dal";
import { listMembers } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await verifySession();
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Only an admin can view members." },
      { status: 403 },
    );
  }
  const members = await listMembers();
  return NextResponse.json(members);
}
