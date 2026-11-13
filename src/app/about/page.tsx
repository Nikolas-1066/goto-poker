import type { Metadata } from "next";
import { AboutPage } from "@/components/site/pages";

export const metadata: Metadata = { title: "О клубе — ГОТО ПОКЕР" };

export default function Page() {
  return <AboutPage />;
}
