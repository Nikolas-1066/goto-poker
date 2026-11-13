import type { Metadata } from "next";
import { ResultsPage } from "@/components/site/pages";

export const metadata: Metadata = { title: "Итоги турниров — ГОТО ПОКЕР" };

export default function Page() {
  return <ResultsPage />;
}
