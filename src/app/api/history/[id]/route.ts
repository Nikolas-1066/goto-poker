import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { correctResults, getTournamentDetails } from "@/lib/db/history";
import { updateDb, withDatabase } from "@/lib/store";

async function tournamentId(ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Итоги турнира
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  const id = await tournamentId(ctx);
  if (!id) return badRequest("Турнир не найден");
  try {
    const tournament = await withDatabase((db) => getTournamentDetails(db, id));
    if (!tournament) return badRequest("Турнир не найден");
    return Response.json({ tournament }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

// Исправить итоги: { results: [{ participantId, place, ko, entries }] }
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return unauthorized();
  const id = await tournamentId(ctx);
  if (!id) return badRequest("Турнир не найден");
  try {
    const body = (await req.json().catch(() => null)) as { results?: unknown } | null;
    let changed = 0;
    // через updateDb: если это текущий турнир, табло и админка увидят изменения
    await updateDb(
      () => undefined,
      (sqlite, next) => {
        changed = correctResults(sqlite, id, body?.results);
        next.tournament.updatedAt = Math.max(Date.now(), next.tournament.updatedAt + 1);
      },
    );
    const tournament = await withDatabase((db) => getTournamentDetails(db, id));
    return Response.json({ tournament, changed });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
