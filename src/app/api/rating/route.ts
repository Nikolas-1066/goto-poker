import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { ratingOverview } from "@/lib/db/periods";
import { withDatabase } from "@/lib/store";

// Рейтинг: открытые периоды, «за всё время», закрытые периоды — для админки
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    return Response.json(await withDatabase((db) => ratingOverview(db)), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
