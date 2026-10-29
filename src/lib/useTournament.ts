"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Tournament, TournamentAction } from "./types";

type StatePayload = { tournament: Tournament; serverNow: number; build?: string; lanUrl?: string | null };

/**
 * Состояние турнира с сервера + локальные «тикающие» часы.
 * Опрашивает сервер раз в `pollMs`, а время считает сам, поправляя
 * разницу между часами устройства и сервера.
 */
export function useTournament(pollMs = 1500) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [online, setOnline] = useState(true);
  const [build, setBuild] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  // Время ставим только в браузере (в эффекте/колбэках): при пререндере
  // Next.js нельзя читать Date.now() во время рендера.
  const [now, setNow] = useState(0);
  const offset = useRef(0);
  const lastUpdated = useRef(0);

  const apply = useCallback((data: StatePayload, sentAt: number) => {
    const receivedAt = Date.now();
    offset.current = data.serverNow - (sentAt + receivedAt) / 2;
    // Не откатываться на более старый ответ опроса, пришедший после действия.
    if (data.tournament.updatedAt < lastUpdated.current) return;
    lastUpdated.current = data.tournament.updatedAt;
    setNow(Date.now() + offset.current);
    setTournament(data.tournament);
  }, []);

  const refresh = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as StatePayload;
      apply(data, sentAt);
      if (data.build) setBuild(data.build);
      setLanUrl(data.lanUrl ?? null);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [apply]);

  useEffect(() => {
    // Первый запрос — сразу при монтировании, дальше — по таймеру.
    const first = setTimeout(refresh, 0);
    const poll = setInterval(refresh, pollMs);
    const tick = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh, pollMs]);

  const send = useCallback(
    async (action: TournamentAction) => {
      const sentAt = Date.now();
      const res = await fetch("/api/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      apply(data as StatePayload, sentAt);
      setNow(Date.now() + offset.current);
      return data.tournament as Tournament;
    },
    [apply],
  );

  return { tournament, now, online, build, lanUrl, send, refresh };
}
