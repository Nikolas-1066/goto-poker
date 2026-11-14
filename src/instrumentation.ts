// Запускается один раз при старте сервера: Telegram-бот и фоновые задачи (docs/SITE.md, шаг 5).
export async function register() {
  // только настоящий сервер на Node — не сборка и не edge
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startBot } = await import("./lib/telegram/runner");
  startBot();
}
