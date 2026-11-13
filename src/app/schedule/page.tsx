import type { Metadata } from "next";
import { SchedulePage } from "@/components/site/pages";

export const metadata: Metadata = { title: "Расписание турниров — ГОТО ПОКЕР" };

export default function Page() {
  return <SchedulePage />;
}
