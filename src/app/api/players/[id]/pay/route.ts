import type { NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { formatRub, PAY_METHOD_LABEL, type PayMethod } from "@/lib/cash";
import { addPayment } from "@/lib/db/cash";
import { updateDb } from "@/lib/store";

// Принять оплату долга из карточки игрока: { tournamentId, amount, method }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return unauthorized();
  const playerId = Number((await ctx.params).id);
  const body = (await req.json().catch(() => null)) as { tournamentId?: number; amount?: number; method?: PayMethod } | null;
  if (!Number.isInteger(playerId) || !body) return badRequest("Некорректный запрос");
  try {
    await updateDb(
      () => null,
      (sqlite, next) => {
        const now = Date.now();
        addPayment(sqlite, { tournamentId: Number(body.tournamentId), playerId, amount: Number(body.amount), method: body.method! }, now);
        // если это текущий турнир — админка и табло увидят изменения
        next.tournament.updatedAt = Math.max(now, next.tournament.updatedAt + 1);
      },
    );
    return Response.json({ message: `Принято ${formatRub(Number(body.amount))} (${PAY_METHOD_LABEL[body.method!].toLowerCase()})` });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
