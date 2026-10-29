import type { NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { changeFinalist, closePeriod, renamePeriod, reopenPeriod, setFinalistsN, startPeriod } from "@/lib/db/periods";
import type { PeriodKind } from "@/lib/db/settings";
import { updateDb } from "@/lib/store";

type Body =
  | { action: "start"; kind: PeriodKind; name?: string; startAt?: number }
  | { action: "close"; periodId: number; nextName?: string; nextStart?: number }
  | { action: "reopen"; periodId: number }
  | { action: "rename"; periodId: number; name: string }
  | { action: "setFinalists"; periodId: number; n: number }
  | { action: "finalist"; periodId: number; playerId: number; change: "add" | "remove"; note?: string };

// Действия владельца с периодами рейтинга
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return badRequest("Некорректный запрос");
  try {
    // через updateDb — табло (рейтинг на табло) увидит изменения
    await updateDb(
      () => undefined,
      (db, next) => {
        switch (body.action) {
          case "start":
            startPeriod(db, body.kind, body);
            break;
          case "close":
            closePeriod(db, Number(body.periodId), body);
            break;
          case "reopen":
            reopenPeriod(db, Number(body.periodId));
            break;
          case "rename":
            renamePeriod(db, Number(body.periodId), body.name);
            break;
          case "setFinalists":
            setFinalistsN(db, Number(body.periodId), body.n);
            break;
          case "finalist":
            changeFinalist(db, Number(body.periodId), Number(body.playerId), body.change, body.note);
            break;
          default:
            throw new Error("Неизвестное действие");
        }
        next.tournament.updatedAt = Math.max(Date.now(), next.tournament.updatedAt + 1);
      },
    );
    return Response.json({ ok: true });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
