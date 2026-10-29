import type { NextRequest } from "next/server";
import { applyAction } from "@/lib/clock";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { recomputeElo } from "@/lib/db/elo";
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
  const hook = hookFor(action);
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

/** Дополнительная запись в базу игроков/истории для некоторых команд часов (в той же транзакции) */
function hookFor(action: TournamentAction | null): WriteHook | undefined {
  switch (action?.type) {
    // новая структура — новый турнир (старый, если в нём играли, уходит в историю)
    case "loadPreset":
      return (sqlite) => void archiveCurrentIfUsed(sqlite);
    // сброс — очистить журнал входов/вылетов, записавшиеся остаются
    case "reset":
      return (sqlite, next) => resetParticipants(sqlite, next);
    // завершение по игрокам — сохранить итоги, очки и ELO; при диле — ошибка (места — в карточке «Игроки»).
    // Повторное «Завершить» уже завершённого итоги (в т.ч. исправленные) не трогает.
    case "finish":
      return (sqlite, next) => {
        const cur = currentTournament(sqlite);
        const was = sqlite.prepare("SELECT status FROM tournaments WHERE id = ?").get(cur.id) as { status: string };
        if (next.tournament.mode === "players" && was.status !== "finished") finalizeResults(sqlite, cur.id);
      };
    // завершённый турнир «открыли» снова — его ELO не считается, пока его не завершат заново
    case "next":
    case "prev":
    case "goto":
    case "restartStep":
      return (sqlite, next) => {
        const was = sqlite.prepare("SELECT status FROM tournaments WHERE is_current = 1").get() as { status: string } | undefined;
        if (was?.status === "finished" && next.tournament.status !== "finished") {
          sqlite.prepare("UPDATE tournaments SET status = ? WHERE is_current = 1").run(next.tournament.status);
          recomputeElo(sqlite);
        }
      };
    default:
      return undefined;
  }
}
