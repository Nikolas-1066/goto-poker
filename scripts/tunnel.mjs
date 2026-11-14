// Временный https-адрес для сайта на этом компьютере (docs/SITE.md, шаг 6): нужен, чтобы проверить
// мини-приложение в Telegram до переезда на сервер. Запуск: `npm run tunnel` (сайт должен быть запущен: npm run dev).
// Программа cloudflared (Cloudflare) выдаёт случайный адрес https://….trycloudflare.com; он записывается
// в data/public-url.txt — бот сам подхватит его для кнопки «Приложение». Ctrl+C — туннель закрыт, адрес стёрт.
// Пока туннель открыт, сайт виден из интернета: админка пускает только со своим паролем (ADMIN_PASSWORD в .env.local).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = process.env.PORT || "3000";
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const file = path.join(dataDir, "public-url.txt");

const cleanup = () => {
  try {
    fs.unlinkSync(file);
  } catch {
    // файла уже нет
  }
};

const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
child.on("error", () => {
  console.error("Не найдена программа cloudflared. Установите: brew install cloudflared");
  process.exit(1);
});

let found = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Новый адрес начинает открываться не сразу (до минуты) — ждём, потом сообщаем боту */
async function announce(url) {
  console.log("Туннель открывается, подождите до минуты…");
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      if (res.status < 500) break;
    } catch {
      // ещё не открывается
    }
    await sleep(3000);
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, url);
  console.log(`\nВременный адрес: ${url}`);
  console.log("Через 15–30 секунд в боте появится кнопка «Приложение» (слева от поля ввода).");
  console.log("Пока это окно открыто, сайт виден из интернета. Закрыть: Ctrl+C\n");
}

const onData = (buf) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buf));
  if (!m || found) return;
  found = true;
  void announce(m[0]);
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    child.kill("SIGINT");
    process.exit(0);
  });
}
child.on("exit", (code) => {
  cleanup();
  if (!found) console.error("Туннель не запустился — проверьте интернет и попробуйте ещё раз.");
  process.exit(code ?? 0);
});
