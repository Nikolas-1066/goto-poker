import type { NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { updatePlayer } from "@/lib/db/players";
import { withDatabase } from "@/lib/store";

// Изменить игрока: { name, phone, note? }
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return badRequest("Игрок не найден");
  try {
    const body = await req.json().catch(() => null);
    const player = await withDatabase((db) => updatePlayer(db, id, body));
    return Response.json({ player });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
