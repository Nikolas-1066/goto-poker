import type { NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { PAY_METHODS, type PayMethod } from "@/lib/cash";
import { addPayment, cancelPayment, setEventFree } from "@/lib/db/cash";
import { getTournamentDetails } from "@/lib/db/history";
import { audit } from "@/lib/db/sqlite";
import { updateDb, withDatabase } from "@/lib/store";

type CashFix =
  | { type: "pay"; playerId: number; amount: number; method: PayMethod }
  | { type: "cancelPayment"; paymentId: number }
  | { type: "setFree"; eventId: number; free: boolean };

/**
 * Исправление кассы турнира из «Истории» (docs/CASH.md): кто сколько фактически занёс.
 * Можно принять оплату больше начисленного (переплата), отменить ошибочную оплату,
 * отметить вход / аддон бесплатным. Всё пишется в журнал.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return badRequest("Турнир не найден");
  const fix = (await req.json().catch(() => null)) as CashFix | null;
  if (!fix) return badRequest("Некорректный запрос");
  let message = "";
  try {
    // через updateDb: если это текущий турнир, админка и табло увидят изменения
    await updateDb(
      () => undefined,
      (sqlite, next) => {
        const exists = sqlite.prepare("SELECT 1 FROM tournaments WHERE id = ?").get(id);
        if (!exists) throw new Error("Турнир не найден");
        const now = Date.now();
        switch (fix.type) {
          case "pay": {
            const playerId = Number(fix.playerId);
            const amount = Math.round(Number(fix.amount));
            if (!PAY_METHODS.includes(fix.method)) throw new Error("Выберите способ оплаты");
            const played = sqlite.prepare("SELECT 1 FROM participants WHERE tournament_id = ? AND player_id = ?").get(id, playerId);
            if (!played) throw new Error("Этот игрок не участвовал в турнире");
            addPayment(sqlite, { tournamentId: id, playerId, amount, method: fix.method }, now, { allowOverpay: true });
            message = "Оплата добавлена";
            break;
          }
          case "cancelPayment":
            cancelPayment(sqlite, id, Number(fix.paymentId), now);
            message = "Оплата отменена";
            break;
          case "setFree":
            setEventFree(sqlite, id, Number(fix.eventId), !!fix.free, now);
            message = fix.free ? "Отмечено бесплатным" : "Отметка «бесплатно» снята";
            break;
          default:
            throw new Error("Неизвестное действие");
        }
        audit(sqlite, "history.cashFix", { tournamentId: id, fix }, now);
        next.tournament.updatedAt = Math.max(now, next.tournament.updatedAt + 1);
      },
    );
    const tournament = await withDatabase((db) => getTournamentDetails(db, id));
    return Response.json({ tournament, message });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
