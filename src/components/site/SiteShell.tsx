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
  { href: "/about", label: "О клубе" },
];

/** Золотая кнопка с переливом — главный призыв на странице */
export const GOLD =
  "bg-gradient-to-b from-amber-200 via-amber-300 to-amber-400 text-[#080e15] font-bold shadow-[0_6px_24px_-8px_rgba(252,211,77,0.7)] hover:from-amber-100 hover:to-amber-300 transition";
/** Кнопка с золотой рамкой — второй по важности призыв */
export const OUTLINE = "border border-amber-300/50 text-amber-100 font-semibold hover:bg-amber-300/10 transition";

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main className="relative flex min-h-screen flex-col bg-[#080e15] text-white">
      {/* мягкое свечение сверху: тёмно-синее с золотым отливом */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[38rem] bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgba(36,64,104,0.55),transparent_70%),radial-gradient(ellipse_40%_30%_at_50%_0%,rgba(252,211,77,0.10),transparent_70%)]"
      />
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#080e15]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:gap-6 sm:px-6 sm:py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image src={logo} alt="ГОТО ПОКЕР" className="h-9 w-auto sm:h-10" priority />
            <span className="hidden font-black tracking-[0.13em] md:inline">
              ГОТО <span className="bg-gradient-to-b from-amber-200 to-amber-400 bg-clip-text text-transparent">ПОКЕР</span>
            </span>
          </Link>
          <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] sm:justify-center sm:gap-1">
            {NAV.map((item) => {
              const on = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-lg px-2.5 py-2 text-sm sm:px-4 ${on ? GOLD : "text-slate-300 hover:bg-white/[0.06] hover:text-white"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="relative mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-6 sm:py-8">{children}</div>

      <footer className="relative border-t border-white/[0.07]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-5 text-xs text-slate-500 sm:px-6">
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
    <section className={`rounded-2xl border border-white/[0.08] bg-[#0f1822]/90 p-4 shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)] sm:p-6 ${className}`}>
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
      <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{children}</h1>
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
 * null в query — ничего не загружать. refreshMs — перечитывать раз в столько мс.
 * keep — пока грузится новый запрос, показывать ответ на прежний (список не мигает при «Показать ещё»).
 */
export function useSite<T>(query: string | null, refreshMs = 0, keep = false): { data: T | null; error: string; loading: boolean } {
  const [state, setState] = useState<{ query: string | null; data: T | null; error: string }>({ query: null, data: null, error: "" });
  useEffect(() => {
    if (query == null) return;
    let alive = true;
    const load = (again: boolean) =>
      fetch(`/api/site?get=${query}`, { cache: "no-store" })
        .then(async (res) => {
          const d = await res.json();
          if (!alive) return;
          if (res.ok) setState({ query, data: d as T, error: "" });
          else if (!again) setState({ query, data: null, error: d.error ?? "Не удалось загрузить" });
        })
        // при повторной загрузке (refreshMs) обрыв связи не стирает уже показанное
        .catch(() => alive && !again && setState({ query, data: null, error: "Нет связи с сервером" }));
    load(false);
    const timer = refreshMs > 0 ? setInterval(() => load(true), refreshMs) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [query, refreshMs]);
  const fresh = state.query === query;
  return { data: fresh || (keep && query != null) ? state.data : null, error: fresh ? state.error : "", loading: query != null && !fresh };
}
