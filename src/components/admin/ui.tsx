"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({
  title,
  action,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-2xl border border-white/[0.09] bg-[#101923]/90 p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-amber-300">{title}</h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "default" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-amber-300 text-[#080e15] hover:bg-amber-200 font-bold",
  default: "border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]",
  danger: "border border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  ghost: "text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]",
};

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm lg:min-h-0 transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export const inputClass =
  "w-full rounded-lg border border-white/10 bg-[#0b131c] px-3 py-2 text-base text-slate-100 sm:text-sm tabular-nums outline-none focus:border-amber-300/60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/** Счётчик с кнопками −/+ */
export function Counter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <div className="flex items-stretch gap-1">
        <Button onClick={() => onChange(Math.max(0, value - 1))} className="w-10 px-0 text-lg">
          −
        </Button>
        <input
          className={`${inputClass} text-center text-lg! font-bold`}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))}
        />
        <Button onClick={() => onChange(value + 1)} className="w-10 px-0 text-lg">
          +
        </Button>
      </div>
    </div>
  );
}
