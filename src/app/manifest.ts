import type { MetadataRoute } from "next";

// Позволяет добавить админку на главный экран телефона как приложение.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ГОТО ПОКЕР — управление турниром",
    short_name: "ГОТО ПОКЕР",
    description: "Табло и управление турнирами клуба ГОТО ПОКЕР",
    start_url: "/admin",
    display: "standalone",
    background_color: "#080e15",
    theme_color: "#080e15",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }],
  };
}
