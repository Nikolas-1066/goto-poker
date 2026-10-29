import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Для ноутбука в клубе собираем автономную версию (BUILD_STANDALONE=1):
  // папка .next/standalone запускается одним node без установки зависимостей.
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  // Картинки отдаём как есть — не нужен нативный модуль sharp (важно для Windows-сборки).
  images: { unoptimized: true },
  // В режиме разработки разрешаем открывать сайт с телефона по IP в локальной сети
  // (иначе Next.js блокирует скрипты и страница не оживает).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
