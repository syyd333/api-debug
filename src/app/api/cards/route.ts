import { NextResponse } from "next/server";
import { listCards } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const cards = await listCards();
  return NextResponse.json({ cards });
}
