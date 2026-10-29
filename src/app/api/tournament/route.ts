import type { NextRequest } from "next/server";
import { applyAction } from "@/lib/clock";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { updateDb } from "@/lib/store";
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
  try {
    const tournament = await updateDb((db) => {
      db.tournament = applyAction(db.tournament, action, Date.now(), (id) =>
        db.presets.find((p) => p.id === id),
      );
      return db.tournament;
    });
    return Response.json({ tournament, serverNow: Date.now() });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
