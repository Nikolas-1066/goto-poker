import type { NextRequest } from "next/server";
import { applyAction } from "@/lib/clock";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { finalizeResults } from "@/lib/db/history";
import { archiveCurrentIfUsed, currentTournament, resetParticipants } from "@/lib/db/tournament";
import { updateDb, type WriteHook } from "@/lib/store";
import type { TournamentAction } from "@/lib/types";

// Управление турниром: { type: "start" | "pause" | ... }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  let action: TournamentAction;
  try {
    action = (await req.json()) as TournamentAction;
  } catch {
    return badRequest("Некорректный запрос");
  }
  // Новая структура — новый турнир (старый уходит в историю); сброс — очистить журнал игроков
  const hook: WriteHook | undefined =
    action?.type === "loadPreset"
      ? (sqlite) => void archiveCurrentIfUsed(sqlite)
      : action?.type === "reset"
        ? (sqlite, next) => resetParticipants(sqlite, next)
        : action?.type === "finish"
          ? (sqlite, next) => {
              // по игрокам — сохранить итоги (при диле — ошибка: места расставляются в карточке «Игроки»)
              // (повторное «Завершить» уже завершённого — не трогает итоги, в т.ч. исправленные)
              const cur = currentTournament(sqlite);
              const was = sqlite.prepare("SELECT status FROM tournaments WHERE id = ?").get(cur.id) as { status: string };
              if (next.tournament.mode === "players" && was.status !== "finished") finalizeResults(sqlite, cur.id);
            }
          : undefined;
  try {
    const tournament = await updateDb((db) => {
      db.tournament = applyAction(db.tournament, action, Date.now(), (id) =>
        db.presets.find((p) => p.id === id),
      );
      return db.tournament;
    }, hook);
    return Response.json({ tournament, serverNow: Date.now() });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
