import { connection, type NextRequest } from "next/server";
import { badRequest, isAdmin, unauthorized } from "@/lib/auth";
import {
  accountOfPlayer,
  confirmRequest,
  getFinalistMessage,
  listRequests,
  photoVersions,
  rejectRequest,
  removeAccount,
  removePhoto,
  resetPassword,
  saveFinalistMessage,
  setPhoto,
} from "@/lib/db/accounts";
import { photoBytes } from "@/lib/playerAuth";
import { syncAllSignups } from "@/lib/db/signups";
import { updateDb, withDatabase } from "@/lib/store";

// Админка: заявки игроков на вход, вход и фото в карточке игрока, сообщение финалистам.

const json = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });

// GET — заявки и сообщение финалистам; GET ?player=ID — вход и фото одного игрока
export async function GET(req: NextRequest) {
  await connection();
  if (!isAdmin(req)) return unauthorized();
  const player = Number(req.nextUrl.searchParams.get("player"));
  try {
    return json(
      await withDatabase((db) =>
        player
          ? { account: accountOfPlayer(db, player), photo: photoVersions(db)[player] ?? null }
          : { requests: listRequests(db), finalistMessage: getFinalistMessage(db) },
      ),
    );
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}

type Body = { action?: string; id?: unknown; playerId?: unknown; data?: unknown; text?: unknown };

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Body;
  const id = Number(body.id);
  const playerId = body.playerId == null || body.playerId === "" ? null : Number(body.playerId);
  try {
    if (body.action === "confirm") {
      // у записей этого человека на турниры появился игрок — если турнир уже открыт, он попадает в него
      let result: unknown;
      await updateDb(
        (db) => db.tournament,
        (sqlite, next) => {
          result = { ...confirmRequest(sqlite, id, playerId), requests: listRequests(sqlite) };
          syncAllSignups(sqlite, next);
        },
      );
      return json(result);
    }
    return json(
      await withDatabase((db) => {
        const needPlayer = () => {
          if (playerId == null || !Number.isInteger(playerId)) throw new Error("Игрок не указан");
          return playerId;
        };
        switch (body.action) {
          case "reject":
            rejectRequest(db, id);
            return { requests: listRequests(db) };
          case "resetPassword":
            return { password: resetPassword(db, needPlayer()) };
          case "removeAccount":
            removeAccount(db, needPlayer());
            return { account: null };
          case "photo": {
            const bytes = photoBytes(body.data);
            if (!bytes) throw new Error("Не получилось прочитать фото — выберите другую картинку");
            return { photo: setPhoto(db, needPlayer(), bytes, "admin") };
          }
          case "removePhoto":
            removePhoto(db, needPlayer(), "admin");
            return { photo: null };
          case "finalistMessage":
            return { finalistMessage: saveFinalistMessage(db, body.text) };
          default:
            throw new Error("Неизвестное действие");
        }
      }),
    );
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "Ошибка");
  }
}
