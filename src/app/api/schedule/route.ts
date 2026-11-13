import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import {
  addItem,
  addTemplate,
  deleteTemplate,
  ensureSchedule,
  getItem,
  linkOpened,
  listSchedule,
  listTemplates,
  markOpened,
  setCancelled,
  updateItem,
  updateTemplate,
} from "@/lib/db/schedule";
import { archiveCurrentIfUsed } from "@/lib/db/tournament";
import { clubToday, openedTournament } from "@/lib/schedule";
import { updateDb, withDatabase } from "@/lib/store";

// Расписание будущих турниров (docs/SITE.md, шаг 2) — для админки.

type Action =
  | { type: "addItem" | "addTemplate"; data: unknown }
  | { type: "updateItem" | "updateTemplate"; id: number; data: unknown }
  | { type: "cancel" | "restore" | "deleteTemplate" | "open"; id: number };

/** Расписание с сегодняшнего дня и постоянные дни; заодно ставит турниры постоянных дней на 2 недели вперёд */
function snapshot(now: number) {
  return withDatabase((db) => {
    const today = clubToday(now);
    ensureSchedule(db, today, now);
    return { today, items: listSchedule(db, today), templates: listTemplates(db) };
  });
}

export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    return Response.json(await snapshot(Date.now()), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  let action: Action;
  try {
    action = (await req.json()) as Action;
  } catch {
    return badRequest("Некорректный запрос");
  }
  const now = Date.now();
  const today = clubToday(now);
  try {
    let message = "";
    if (action.type === "open") {
      const id = Number(action.id);
      const item = await withDatabase((db) => getItem(db, id));
      // новый турнир и отметка в расписании — одной транзакцией; ошибка (текущий ещё идёт) откатывает всё
      await updateDb(
        (db) => {
          db.tournament = openedTournament(db.tournament, item, now, (pid) => db.presets.find((p) => p.id === pid));
        },
        (sqlite) => {
          markOpened(sqlite, id, now);
          archiveCurrentIfUsed(sqlite, now);
        },
      );
      await withDatabase((db) => linkOpened(db, id));
      message = `Турнир «${item.name}» открыт — он на табло и в «Управлении»`;
    } else {
      message = await withDatabase((db) => {
        switch (action.type) {
          case "addItem":
            return `Добавлен: ${addItem(db, action.data, today, now).name}`;
          case "updateItem":
            return `Сохранено: ${updateItem(db, Number(action.id), action.data, today, now).name}`;
          case "cancel":
            return `Отменён: ${setCancelled(db, Number(action.id), true, now).name}`;
          case "restore":
            return `Возвращён в расписание: ${setCancelled(db, Number(action.id), false, now).name}`;
          case "addTemplate":
            return `Постоянный день добавлен: ${addTemplate(db, action.data, today, now).name}`;
          case "updateTemplate":
            return `Постоянный день сохранён: ${updateTemplate(db, Number(action.id), action.data, today, now).name}`;
          case "deleteTemplate":
            deleteTemplate(db, Number(action.id), today, now);
            return "Постоянный день убран";
          default:
            throw new Error("Неизвестное действие");
        }
      });
    }
    return Response.json({ message, ...(await snapshot(now)) });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
