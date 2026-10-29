import type { NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { sanitizePreset } from "@/lib/presets";
import { updateDb } from "@/lib/store";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return unauthorized();
  const { id } = await ctx.params;
  try {
    const preset = sanitizePreset(await req.json(), id);
    await updateDb((db) => {
      const i = db.presets.findIndex((p) => p.id === id);
      if (i < 0) throw new Error("Пресет не найден");
      db.presets[i] = preset;
    });
    return Response.json({ preset });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return unauthorized();
  const { id } = await ctx.params;
  try {
    await updateDb((db) => {
      if (db.presets.length <= 1) throw new Error("Нельзя удалить последний пресет");
      db.presets = db.presets.filter((p) => p.id !== id);
    });
    return Response.json({ ok: true });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
