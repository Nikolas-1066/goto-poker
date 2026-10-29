import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { currentRules, saveRules } from "@/lib/db/rules";
import { withDatabase } from "@/lib/store";

// Текущие правила рейтинга
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    const version = await withDatabase((db) => currentRules(db));
    return Response.json({ version }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

// Сохранить правила (новой версией): { rules }
export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const body = (await req.json().catch(() => null)) as { rules?: unknown } | null;
    const result = await withDatabase((db) => saveRules(db, body?.rules));
    return Response.json(result);
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
