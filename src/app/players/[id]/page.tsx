import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayerPage } from "@/components/site/pages";

export const metadata: Metadata = { title: "Игрок — ГОТО ПОКЕР" };

// Страница игрока на сайте. Номер игрока известен только при запросе — поэтому вся страница
// (вместе с шапкой, которая читает адрес) — внутри Suspense.
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#080e15]" />}>{params.then(({ id }) => <PlayerPage id={Number(id)} />)}</Suspense>
  );
}
