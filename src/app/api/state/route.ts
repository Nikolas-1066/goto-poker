import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { connection } from "next/server";
import { resolveClock } from "@/lib/clock";
import { readDb } from "@/lib/store";

/** Номер сборки: табло само перезагрузится, когда на сервер выкатят новую версию. */
let build: string | null = null;
function buildId() {
  if (build !== null) return build;
  try {
    build = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    build = "dev";
  }
  return build;
}

/** Адрес в локальной сети клуба (режим ноутбука) — чтобы открыть админку с телефона. */
function lanUrl() {
  if (process.env.LAN_MODE !== "1") return null;
  if (process.env.LAN_URL) return process.env.LAN_URL;
  const port = process.env.PORT || "3000";
  // Пропускаем виртуальные адаптеры (WSL, Hyper-V, VirtualBox, VPN) — у них «чужие» адреса
  const virtual = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|tailscale|zerotier|vpn|tun|utun|bridge/i;
  const found: { ip: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const rank = a.address.startsWith("192.168.") ? 0 : a.address.startsWith("10.") ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : -1;
      if (rank >= 0) found.push({ ip: a.address, rank });
    }
  }
  found.sort((x, y) => x.rank - y.rank);
  return found[0] ? `http://${found[0].ip}:${port}` : null;
}

// Публичное состояние для табло: турнир + время сервера (для синхронизации часов).
export async function GET() {
  await connection();
  const db = await readDb();
  const now = Date.now();
  return Response.json(
    {
      tournament: db.tournament,
      serverNow: now,
      clock: resolveClock(db.tournament, now),
      build: process.env.NODE_ENV === "production" ? buildId() : "dev",
      lanUrl: lanUrl(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
