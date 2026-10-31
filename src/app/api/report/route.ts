import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { isReportSent, markReportSent, tournamentReport } from "@/lib/db/report";
import { currentTournament } from "@/lib/db/tournament";
import { withDatabase } from "@/lib/store";

const idOf = (req: NextRequest) => {
  const v = req.nextUrl.searchParams.get("id");
  return v ? Number(v) : null;
};

// Отчёт владельцу по завершённому турниру: ?id=123 (без id — текущий турнир)
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    const data = await withDatabase((db) => {
      const id = idOf(req) ?? currentTournament(db).id;
      const report = tournamentReport(db, id);
      if (!report) throw new Error("Турнир не найден");
      return { report, sent: isReportSent(db, id) };
    });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

// Отчёт скопирован / сохранён — убрать напоминание: { id }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return badRequest("Турнир не найден");
  try {
    await withDatabase((db) => markReportSent(db, id));
    return Response.json({ sent: true });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
