import { NextResponse } from "next/server";
import { getAppSession } from "@/lib/auth/session";
import { getPeople } from "@/lib/google/sheets";

export async function GET() {
  const session = await getAppSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const people = await getPeople();
  return NextResponse.json({ people });
}
