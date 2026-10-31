import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import { stamp } from "@/lib/db/sqlite";
import { isOwner, ownerRequired } from "@/lib/owner";
import { databaseCopy } from "@/lib/store";

// Скачать копию всей базы (только владельцу). Восстановление — README-RU.txt, «Резервные копии».
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  if (!(await isOwner(req))) return ownerRequired();
  try {
    const file = await databaseCopy();
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="goto-poker-${stamp(Date.now())}-copy.db"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
