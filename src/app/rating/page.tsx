import type { Metadata } from "next";
import { RatingPage } from "@/components/site/pages";

export const metadata: Metadata = { title: "Рейтинг — ГОТО ПОКЕР" };

export default function Page() {
  return <RatingPage />;
}
