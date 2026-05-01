import { NextResponse } from "next/server";
import { getPushSupportStatus } from "@/lib/notifications/store";

export async function GET() {
  const support = getPushSupportStatus();
  return NextResponse.json({
    supported: support.supported,
    publicKey: support.supported ? support.publicKey : "",
  });
}
