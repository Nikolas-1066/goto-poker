import { Suspense } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { PlayerCard } from "@/components/admin/PlayerCard";

// Карточка игрока. Номер игрока известен только при запросе — поэтому вся страница
// (вместе с шапкой, которая читает адрес) — внутри Suspense.
export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#080e15]" />}>
      {params.then(({ id }) => (
        <AdminShell>
          <PlayerCard id={Number(id)} />
        </AdminShell>
      ))}
    </Suspense>
  );
}
