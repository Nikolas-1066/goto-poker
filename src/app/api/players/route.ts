import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { debtsByPlayer } from "@/lib/db/cash";
import { createPlayer, listPlayers } from "@/lib/db/players";
import { withDatabase } from "@/lib/store";

// Список игроков — только для админки: там телефоны.
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  try {
    const { players, debts } = await withDatabase((db) => ({
      players: listPlayers(db),
      // долг по всем турнирам: { [playerId]: сумма }
      debts: Object.fromEntries([...debtsByPlayer(db)].map(([id, list]) => [id, list.reduce((s, d) => s + d.debt, 0)])),
    }));
    return Response.json({ players, debts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

// Новый игрок: { name, phone, note? }
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const body = await req.json().catch(() => null);
    const player = await withDatabase((db) => createPlayer(db, body));
    return Response.json({ player });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
