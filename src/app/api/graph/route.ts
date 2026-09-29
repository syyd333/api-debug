import { NextResponse } from "next/server";
import { listEdges } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const edges = await listEdges();
  return NextResponse.json({ edges });
}
