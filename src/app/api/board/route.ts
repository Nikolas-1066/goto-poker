import { connection } from "next/server";
import { boardRating } from "@/lib/db/board";
import { hasDatabase, withDatabase } from "@/lib/store";

// Рейтинг для табло — без пароля (табло открыто на ТВ), только имена и очки
export async function GET() {
  await connection();
  try {
    if (!(await hasDatabase())) return Response.json(null, { headers: { "Cache-Control": "no-store" } });
    return Response.json(await withDatabase((db) => boardRating(db)), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(null, { headers: { "Cache-Control": "no-store" } });
  }
}
