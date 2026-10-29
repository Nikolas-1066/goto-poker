import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { applyPlayerAction, currentTournament, listParticipants, NeedsForceError, type PlayerAction } from "@/lib/db/tournament";
import { hasDatabase, readDb, updateDb, withDatabase } from "@/lib/store";

const NO_DB = "Учёт игроков недоступен: программа работает в запасном режиме (см. журнал сервера)";

// Участники текущего турнира — только для админки
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    if (!(await hasDatabase())) return badRequest(NO_DB);
    const { tournament } = await readDb();
    const participants = await withDatabase((db) =>
      listParticipants(db, currentTournament(db).id, tournament.status === "finished"),
    );
    return Response.json(
      { mode: tournament.mode, updatedAt: tournament.updatedAt, participants },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

// Действие с участником: { type: "register" | "enter" | "reentry" | "addon" | ... }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  const action = (await req.json().catch(() => null)) as PlayerAction | null;
  if (!action || typeof action !== "object") return badRequest("Некорректный запрос");
  try {
    if (!(await hasDatabase())) return badRequest(NO_DB);
    const tournament = await updateDb(
      (db) => db.tournament,
      (sqlite, next) => applyPlayerAction(sqlite, next, action),
    );
    return Response.json({ tournament, serverNow: Date.now() });
  } catch (err) {
    if (err instanceof NeedsForceError) return Response.json({ error: err.message, needsForce: true }, { status: 409 });
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
