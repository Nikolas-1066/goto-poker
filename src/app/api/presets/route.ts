import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { newId, sanitizePreset } from "@/lib/presets";
import { readDb, updateDb } from "@/lib/store";

export async function GET() {
  await connection();
  const db = await readDb();
  return Response.json({ presets: db.presets }, { headers: { "Cache-Control": "no-store" } });
}

// Создать пресет (в т.ч. копию существующего — клиент присылает данные целиком)
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  try {
    const preset = sanitizePreset(await req.json(), newId());
    await updateDb((db) => {
      db.presets.push(preset);
    });
    return Response.json({ preset });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
