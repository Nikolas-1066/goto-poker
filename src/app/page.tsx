import type { Metadata } from "next";
import { HomePage } from "@/components/site/pages";

export const metadata: Metadata = { title: "ГОТО ПОКЕР — клуб спортивного покера в Воронеже" };

export default function Page() {
  return <HomePage />;
}
