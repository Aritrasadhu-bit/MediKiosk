import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { listBackups, readLastDrill } from "@/lib/server/db";

export const runtime = "nodejs";

/** Admin-only: list archived backups (with SHA-256 sidecar hashes, newest first). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "Admins only." }, { status: 403 });

  const backups = await listBackups();
  return NextResponse.json({ ok: true, backups, lastDrill: await readLastDrill() });
}