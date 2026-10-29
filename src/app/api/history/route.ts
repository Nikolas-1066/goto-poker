import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { listHistory } from "@/lib/db/history";
import { withDatabase } from "@/lib/store";

// История турниров — только для админки
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    const tournaments = await withDatabase((db) => listHistory(db));
    return Response.json({ tournaments }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
