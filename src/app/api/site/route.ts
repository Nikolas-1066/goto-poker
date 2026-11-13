import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { getAbout, saveAbout, siteArchive, siteFacts, siteLive, sitePlayer, siteRating, siteResultFull, siteResults, siteSchedule } from "@/lib/db/site";
import { withDatabase } from "@/lib/store";

// Данные для сайта клуба (docs/SITE.md) — без пароля: только имена, места, очки, нокауты и ELO.
// GET /api/site?get=rating | archive&id= | results&limit= | result&id= | live | player&id= | schedule | facts | about

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams;
  const id = Number(q.get("id"));
  try {
    switch (q.get("get")) {
      case "rating":
        return json(await withDatabase((db) => siteRating(db)));
      case "archive": {
        const period = Number.isInteger(id) ? await withDatabase((db) => siteArchive(db, id)) : null;
        return period ? json(period) : json({ error: "Такого периода в архиве нет" }, 404);
      }
      case "results":
        return json(
          await withDatabase((db) => {
            const limit = Math.min(200, Math.max(1, Math.trunc(Number(q.get("limit"))) || 10));
            return { results: siteResults(db, limit), total: siteFacts(db).tournaments };
          }),
        );
      case "result": {
        const result = Number.isInteger(id) ? await withDatabase((db) => siteResultFull(db, id)) : null;
        return result ? json(result) : json({ error: "Турнир не найден" }, 404);
      }
      case "live":
        return json({ live: await withDatabase((db) => siteLive(db)) });
      case "player": {
        const player = Number.isInteger(id) ? await withDatabase((db) => sitePlayer(db, id)) : null;
        return player ? json(player) : json({ error: "Игрок не найден" }, 404);
      }
      case "schedule":
        return json(await withDatabase((db) => siteSchedule(db)));
      case "facts":
        return json(await withDatabase((db) => siteFacts(db)));
      case "about":
        return json(await withDatabase((db) => getAbout(db)));
      default:
        return json({ error: "Неизвестный запрос" }, 400);
    }
  } catch {
    // база недоступна (запасной режим) — сайт покажет «скоро появится»
    return json({ error: "Данные временно недоступны" }, 503);
  }
}

// Сохранить «О клубе» — только из админки
export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const about = await req.json();
    return json(await withDatabase((db) => saveAbout(db, about)));
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
