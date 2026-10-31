import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { isOwner, ownerRequired } from "@/lib/owner";
import { outdatedCount, rescoreAll } from "@/lib/db/history";
import { updateDb, withDatabase } from "@/lib/store";

// Сколько турниров посчитано не по текущим правилам
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    return Response.json(await withDatabase((db) => outdatedCount(db)), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

// «Пересчитать»: очки всех завершённых турниров по текущим правилам
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  if (!(await isOwner(req))) return ownerRequired();
  try {
    let tournaments = 0;
    // через updateDb — табло и админка увидят обновление
    await updateDb(
      () => undefined,
      (sqlite, next) => {
        tournaments = rescoreAll(sqlite);
        next.tournament.updatedAt = Math.max(Date.now(), next.tournament.updatedAt + 1);
      },
    );
    return Response.json({ tournaments, ...(await withDatabase((db) => outdatedCount(db))) });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
