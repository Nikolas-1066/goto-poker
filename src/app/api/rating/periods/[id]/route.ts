import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { getPeriod, periodView } from "@/lib/db/periods";
import { withDatabase } from "@/lib/store";

// Один период: таблица (у закрытого — замороженная), финалисты, правки
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  try {
    const view = await withDatabase((db) => {
      const p = getPeriod(db, id);
      return p ? periodView(db, p) : null;
    });
    if (!view) return badRequest("Период не найден");
    return Response.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
