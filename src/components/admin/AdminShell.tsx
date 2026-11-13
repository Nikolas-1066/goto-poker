"use client";

import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/logo.png";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, inputClass } from "./ui";

// short — подпись на узком экране телефона, чтобы всё меню помещалось в одну строку
const NAV = [
  { href: "/admin", label: "Управление", short: "Турнир" },
  { href: "/admin/schedule", label: "Расписание", short: "Распис." },
  { href: "/admin/presets", label: "Структуры", short: "Пресеты" },
  { href: "/admin/players", label: "Игроки", short: "Игроки" },
  { href: "/admin/history", label: "История", short: "История" },
  { href: "/admin/rating", label: "Рейтинг", short: "Рейтинг" },
  { href: "/admin/stats", label: "Статистика", short: "Стат." },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<boolean | null>(null);
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);

  // на узком экране меню прокручивается — открытый раздел показываем в видимой части
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname, admin]);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAdmin(!!d.admin))
      .catch(() => setAdmin(false));
  }, []);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    setAdmin(false);
  }

  return (
    <main className="min-h-screen bg-[#080e15] text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#080e15]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-2 px-3 py-2 md:px-6 md:py-3">
          <div className="flex min-w-0 items-center gap-2 md:gap-6">
            {/* на узком экране после входа логотип прячем — иначе меню не помещается */}
            <Link href="/admin" className={`${admin ? "hidden sm:flex" : "flex"} shrink-0 items-center gap-2`}>
              <Image src={logo} alt="ГОТО ПОКЕР" className="h-8 w-auto md:h-9" priority />
              <span className="hidden font-black tracking-[0.13em] md:inline">
                ГОТО <span className="text-amber-300">ПОКЕР</span>
              </span>
            </Link>
            {admin && (
              <nav ref={nav} className="flex min-w-0 gap-0 overflow-x-auto sm:gap-1 whitespace-nowrap [scrollbar-width:none]">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={pathname === item.href ? "page" : undefined}
                    className={`rounded-lg px-1.5 py-1.5 text-[13px] sm:px-2 sm:text-sm md:px-3 ${
                      pathname === item.href
                        ? "bg-white/[0.08] text-white"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span className="hidden sm:inline">{item.label}</span>
                    <span className="sm:hidden">{item.short}</span>
                  </Link>
                ))}
              </nav>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1 md:gap-2">
            <a
              href="/tablo"
              target="_blank"
              rel="noreferrer"
              title="Табло"
              className={`${admin ? "hidden sm:inline-block" : ""} rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:text-slate-200 md:px-3`}
            >
              <span className="hidden sm:inline">Табло </span>↗
            </a>
            {admin && (
              <Button variant="ghost" onClick={logout} title="Выйти" className="px-2 md:px-3">
                <span className="hidden md:inline">Выйти</span>
                <span className="md:hidden">⎋</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-3 py-4 md:px-6 md:py-6">
        {admin === null ? (
          <div className="py-20 text-center text-slate-500">Загрузка…</div>
        ) : admin ? (
          children
        ) : (
          <Login onSuccess={() => setAdmin(true)} />
        )}
      </div>
    </main>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) onSuccess();
    else setError("Неверный пароль");
  }

  return (
    <form
      onSubmit={submit}
      className="mx-auto mt-16 max-w-sm rounded-2xl border border-white/[0.09] bg-[#101923]/90 p-6"
    >
      <h1 className="text-lg font-bold">Вход в админку</h1>
      <p className="mt-1 text-sm text-slate-500">Управление турниром и структурами блайндов</p>
      <input
        type="password"
        autoFocus
        placeholder="Пароль"
        className={`${inputClass} mt-5`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy || !password}>
        Войти
      </Button>
    </form>
  );
}
