import { NextResponse } from "next/server";
import { readSettings } from "@/lib/server/settings";

export const runtime = "nodejs";

/** First-run wizard status (public): has the site been configured yet? */
export async function GET() {
  const settings = await readSettings();
  return NextResponse.json({
    ok: true,
    configured: settings.configured,
    hospitalName: settings.hospitalName,
    departments: settings.departments,
  });
}