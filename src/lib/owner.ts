// Доступ владельца в route handlers: админ + cookie владельца (пароль владельца — src/lib/db/owner.ts).

import type { NextRequest } from "next/server";
import { isAdmin } from "./auth";
import { hasOwnerPassword, isOwnerToken, resetOwnerPassword } from "./db/owner";
import { takeOwnerResetRequest, withDatabase } from "./store";

export const OWNER_COOKIE = "goto_owner";

/** Админ, вошедший как владелец */
export async function isOwner(req: NextRequest) {
  if (!isAdmin(req)) return false;
  const token = req.cookies.get(OWNER_COOKIE)?.value;
  if (!token) return false;
  return withDatabase((db) => isOwnerToken(db, token));
}

export function ownerRequired() {
  return Response.json({ error: "Нужен пароль владельца", ownerRequired: true }, { status: 403 });
}

/** Состояние для админки; заодно выполняет сброс пароля, если на ноутбуке положили файл-сброс */
export async function ownerState(req: NextRequest) {
  const reset = await takeOwnerResetRequest();
  const set = await withDatabase((db) => {
    if (reset) resetOwnerPassword(db);
    return hasOwnerPassword(db);
  });
  return { set, owner: set && (await isOwner(req)) };
}
