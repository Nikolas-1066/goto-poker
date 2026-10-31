import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { loadStatsData } from "@/lib/db/stats";
import { isOwner, ownerRequired } from "@/lib/owner";
import { breakdown, computeStats, periodRange, periodsOf } from "@/lib/stats";
import { withDatabase } from "@/lib/store";

// Статистика клуба: ?period=2026-10 (месяц) | 2026 (год) | all (за всё время)
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  if (!(await isOwner(req))) return ownerRequired();
  const period = req.nextUrl.searchParams.get("period") ?? "all";
  const range = period === "all" ? { from: 0, to: Number.MAX_SAFE_INTEGER } : periodRange(period);
  if (!range) return badRequest("Непонятный период");
  try {
    const data = await withDatabase((db) => loadStatsData(db));
    const isYear = /^\d{4}$/.test(period);
    return Response.json(
      {
        period,
        summary: computeStats(data, range),
        // за год — по месяцам; за всё время — по годам; за месяц — не нужно
        breakdown: period === "all" ? breakdown(data, "year") : isYear ? breakdown(data, "month", range) : [],
        months: periodsOf(data, "month"),
        years: periodsOf(data, "year"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
