import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { playerCard } from "@/lib/db/playercard";
import { updatePlayer } from "@/lib/db/players";
import { withDatabase } from "@/lib/store";

// Карточка игрока: турниры, статистика, рейтинги, ELO
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  try {
    const card = await withDatabase((db) => playerCard(db, id));
    if (!card) return badRequest("Игрок не найден");
    return Response.json(card, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

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
