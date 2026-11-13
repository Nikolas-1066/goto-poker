import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { tournamentCash } from "@/lib/db/cash";
import { getSeating } from "@/lib/db/seating";
import { guestsOfTournament } from "@/lib/db/signups";
import {
  applyPlayerAction,
  currentTournament,
  finalInfo,
  listParticipants,
  NeedsForceError,
  type PlayerAction,
  type PlayerActionResult,
} from "@/lib/db/tournament";
import { hasDatabase, readDb, updateDb, withDatabase } from "@/lib/store";

const NO_DB = "Учёт игроков недоступен: программа работает в запасном режиме (см. журнал сервера)";

// Участники текущего турнира — только для админки
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    if (!(await hasDatabase())) return badRequest(NO_DB);
    const { tournament } = await readDb();
    const { participants, final, cash, seating, guests } = await withDatabase((db) => {
      const id = currentTournament(db).id;
      return {
        participants: listParticipants(db, id, tournament.status === "finished"),
        final: finalInfo(db),
        cash: tournamentCash(db, id).summary,
        seating: getSeating(db),
        guests: guestsOfTournament(db, id),
      };
    });
    return Response.json(
      { mode: tournament.mode, updatedAt: tournament.updatedAt, participants, final, cash, seating, guests },
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
    let result: PlayerActionResult = { message: "", undoEventId: null };
    const tournament = await updateDb(
      (db) => db.tournament,
      (sqlite, next) => {
        result = applyPlayerAction(sqlite, next, action);
      },
    );
    return Response.json({ tournament, serverNow: Date.now(), ...result });
  } catch (err) {
    if (err instanceof NeedsForceError) return Response.json({ error: err.message, needsForce: true }, { status: 409 });
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
