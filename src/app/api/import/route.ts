import { type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { applyList, checkList, parseTarget } from "@/lib/db/importList";
import { hasDatabase, updateDb, withDatabase } from "@/lib/store";

// «Вставить список» из Google-таблицы — только для админки.
// { action: "check", text, target } — разобрать и найти игроков (ничего не меняет)
// { action: "apply", items, target } — записать всех (новых — завести в базе)

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as { action?: string; text?: unknown; items?: unknown; target?: unknown } | null;
  if (!body) return badRequest("Некорректный запрос");
  try {
    if (!(await hasDatabase())) return badRequest("Учёт игроков недоступен: программа работает в запасном режиме");
    const target = parseTarget(body.target);
    if (body.action === "check") {
      const rows = await withDatabase((db) => checkList(db, String(body.text ?? ""), target));
      return Response.json({ rows }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "apply") {
      let result = { added: 0, created: 0, skipped: [] as string[] };
      const now = Date.now();
      await updateDb(
        (db) => db.tournament,
        (sqlite, next) => {
          result = applyList(sqlite, next, target, body.items, now);
        },
      );
      return Response.json(result);
    }
    return badRequest("Неизвестное действие");
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
