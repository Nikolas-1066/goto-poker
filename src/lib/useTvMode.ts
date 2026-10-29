"use client";

import { useEffect, useRef, useState } from "react";
import { tryAutoUnlock } from "./sound";

/**
 * Режим табло на телевизоре:
 * - экран не гаснет (Wake Lock);
 * - звук включается сам, если браузер разрешает автозапуск;
 * - курсор прячется через 3 с без движения мыши;
 * - после обновления сервера страница перезагружается сама
 *   (но не посреди идущего уровня — ждёт паузы или перерыва).
 */
export function useTvMode({ build, canReload }: { build: string | null; canReload: boolean }) {
  const [autoSound, setAutoSound] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const firstBuild = useRef<string | null>(null);

  // Экран не гаснет
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      navigator.wakeLock
        .request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => {});
    };
  }, []);

  // Автовключение звука
  useEffect(() => {
    let alive = true;
    tryAutoUnlock().then((ok) => alive && setAutoSound(ok));
    return () => {
      alive = false;
    };
  }, []);

  // Прятать курсор
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onMove = () => {
      setCursorHidden(false);
      clearTimeout(timer);
      timer = setTimeout(() => setCursorHidden(true), 3000);
    };
    timer = setTimeout(() => setCursorHidden(true), 3000);
    window.addEventListener("mousemove", onMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // Перезагрузка после выката новой версии
  useEffect(() => {
    if (!build || build === "dev") return;
    if (firstBuild.current === null) {
      firstBuild.current = build;
      return;
    }
    if (build !== firstBuild.current && canReload) window.location.reload();
  }, [build, canReload]);

  return { autoSound, cursorHidden };
}
