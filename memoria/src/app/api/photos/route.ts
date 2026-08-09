import { NextResponse } from "next/server";
import { listPhotos } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const photos = await listPhotos();
  return NextResponse.json(photos);
}
