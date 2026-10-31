import type { NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { isOwner, ownerRequired } from "@/lib/owner";
import { saveSettings } from "@/lib/db/settings";
import { withDatabase } from "@/lib/store";

// Настройки рейтинга: сезон/год вкл/выкл, N финалистов по умолчанию, табло
export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  if (!(await isOwner(req))) return ownerRequired();
  try {
    const body = await req.json().catch(() => null);
    const settings = await withDatabase((db) => saveSettings(db, body));
    return Response.json({ settings });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
