import { connection, type NextRequest } from "next/server";
import { getPhoto } from "@/lib/db/accounts";
import { withDatabase } from "@/lib/store";

// Фото игрока — без пароля (оно и так показано на сайте): /api/photo?id=5&v=версия.
// В адресе версия фото, поэтому браузер может хранить картинку долго: новое фото — новый адрес.
export async function GET(req: NextRequest) {
  await connection();
  const id = Number(req.nextUrl.searchParams.get("id"));
  try {
    const jpeg = Number.isInteger(id) && id > 0 ? await withDatabase((db) => getPhoto(db, id)) : null;
    if (!jpeg) return new Response(null, { status: 404 });
    return new Response(Buffer.from(jpeg), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
