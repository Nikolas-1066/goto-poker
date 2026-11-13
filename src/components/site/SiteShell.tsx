"use client";

// Каркас сайта клуба (docs/SITE.md): шапка с меню и подвал. Используется внутри каждой страницы сайта
// (а не в layout): шапка читает адрес страницы, и у страниц с номером в адресе она должна быть внутри Suspense.

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import logo from "@/assets/logo.png";

const NAV = [
  { href: "/schedule", label: "Расписание" },
  { href: "/rating", label: "Рейтинг" },
  { href: "/results", label: "Итоги" },
  { href: "/about", label: "О клубе" },
];

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main className="flex min-h-screen flex-col bg-[#080e15] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#080e15]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:gap-6 sm:px-6 sm:py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src={logo} alt="ГОТО ПОКЕР" className="h-8 w-auto sm:h-9" priority />
            <span className="hidden font-black tracking-[0.13em] sm:inline">
              ГОТО <span className="text-amber-300">ПОКЕР</span>
            </span>
          </Link>
          <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] sm:gap-1">
            {NAV.map((item) => {
              const on = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-lg px-2 py-2 text-sm sm:px-3 ${on ? "bg-white/[0.08] text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-6 sm:py-8">{children}</div>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-3 py-4 text-xs text-slate-500 sm:px-6">
          <span>ГОТО ПОКЕР · клуб спортивного покера · Воронеж</span>
          <span>Спортивный покер: играем на очки и рейтинг, не на деньги</span>
        </div>
      </footer>
    </main>
  );
}

// ---------- Общие детали страниц ----------

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/[0.09] bg-[#101923]/90 p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-300">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 sm:mb-6">
      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{children}</h1>
      {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
    </div>
  );
}

export function PlayerLink({ id, name, className = "" }: { id: number; name: string; className?: string }) {
  return (
    <Link href={`/players/${id}`} className={`hover:text-amber-200 hover:underline ${className}`}>
      {name}
    </Link>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <div className="py-8 text-center text-sm text-slate-500">{children}</div>;

/** «1,5» — нокауты с половинками */
export const formatKo = (ko: number) => String(ko).replace(".", ",");

/**
 * Загрузить данные сайта: /api/site?get=…  (query — без «?get=», например "rating" или "player&id=5").
 * null в query — ничего не загружать.
 */
export function useSite<T>(query: string | null): { data: T | null; error: string; loading: boolean } {
  const [state, setState] = useState<{ query: string | null; data: T | null; error: string }>({ query: null, data: null, error: "" });
  useEffect(() => {
    if (query == null) return;
    let alive = true;
    fetch(`/api/site?get=${query}`, { cache: "no-store" })
      .then(async (res) => {
        const d = await res.json();
        if (!alive) return;
        if (res.ok) setState({ query, data: d as T, error: "" });
        else setState({ query, data: null, error: d.error ?? "Не удалось загрузить" });
      })
      .catch(() => alive && setState({ query, data: null, error: "Нет связи с сервером" }));
    return () => {
      alive = false;
    };
  }, [query]);
  const fresh = state.query === query;
  return { data: fresh ? state.data : null, error: fresh ? state.error : "", loading: query != null && !fresh };
}
