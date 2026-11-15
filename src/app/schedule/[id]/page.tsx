import type { Metadata } from "next";
import { Suspense } from "react";
import { EventPage } from "@/components/site/EventPage";

export const metadata: Metadata = { title: "Турнир — ГОТО ПОКЕР" };

// Страница турнира из расписания. Номер известен только при запросе — вся страница (с шапкой) внутри Suspense.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<main className="min-h-screen bg-[#080e15]" />}>{params.then(({ id }) => <EventPage id={Number(id)} />)}</Suspense>;
}
