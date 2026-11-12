import type { NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { addExpense, deleteExpense } from "@/lib/db/expenses";
import { getTournamentDetails } from "@/lib/db/history";
import { updateDb, withDatabase } from "@/lib/store";

/** Расходы турнира: { type: "add", kind, name, hours, amount, note } | { type: "delete", expenseId } */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return badRequest("Турнир не найден");
  const body = (await req.json().catch(() => null)) as { type?: string; expenseId?: number } | null;
  if (!body) return badRequest("Некорректный запрос");
  try {
    await updateDb(
      () => undefined,
      (sqlite) => {
        if (!sqlite.prepare("SELECT 1 FROM tournaments WHERE id = ?").get(id)) throw new Error("Турнир не найден");
        if (body.type === "add") addExpense(sqlite, id, body);
        else if (body.type === "delete") deleteExpense(sqlite, id, Number(body.expenseId));
        else throw new Error("Неизвестное действие");
      },
    );
    const tournament = await withDatabase((db) => getTournamentDetails(db, id));
    return Response.json({ tournament });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
