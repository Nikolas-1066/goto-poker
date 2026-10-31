import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { exportSheets } from "@/lib/db/export";
import { isOwner, ownerRequired } from "@/lib/owner";
import { periodLabel, periodRange } from "@/lib/stats";
import { withDatabase } from "@/lib/store";
import { buildXlsx } from "@/lib/xlsx";

// Excel за период: ?period=2026-10 | 2026 | all — только владельцу
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  if (!(await isOwner(req))) return ownerRequired();
  const period = req.nextUrl.searchParams.get("period") ?? "all";
  const range = period === "all" ? { from: 0, to: Number.MAX_SAFE_INTEGER } : periodRange(period);
  if (!range) return badRequest("Непонятный период");
  const title = period === "all" ? "За всё время" : periodLabel(period);
  try {
    const file = buildXlsx(await withDatabase((db) => exportSheets(db, range, title)));
    const name = `ГОТО ПОКЕР — ${title}.xlsx`;
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="goto-poker-${period}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
