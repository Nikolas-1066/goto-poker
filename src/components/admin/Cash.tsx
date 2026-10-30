"use client";

// Касса в карточке «Игроки» (docs/CASH.md): плашка оплаты у игрока, окно оплаты,
// «Пришёл + оплатил» и строка итога кассы.

import { useState } from "react";
import {
  CHARGE_LABEL,
  debtWarning,
  formatRub,
  PAY_METHOD_LABEL,
  PAY_METHODS,
  type CashSummary,
  type PayMethod,
  type PlayerCash,
} from "@/lib/cash";
import type { PlayerDebt } from "@/lib/db/cash";
import { Button, inputClass } from "./ui";

/** Есть ли у игрока что показывать в кассе */
export const hasCash = (c: PlayerCash) => c.charges.some((x) => x.price > 0) || c.payments.length > 0;

/** Плашка: «Оплачено» / «Должен 1 500 ₽» / «Бесплатно» / «Переплата 500 ₽». Нажатие — окно оплаты */
export function PayBadge({ cash, open, onClick }: { cash: PlayerCash; open: boolean; onClick: () => void }) {
  if (!hasCash(cash)) return null;
  const [text, color] =
    cash.debt > 0
      ? [`Должен ${formatRub(cash.debt)}`, "border-red-400/40 bg-red-500/15 text-red-300"]
      : cash.debt < 0
        ? [`Переплата ${formatRub(-cash.debt)}`, "border-amber-300/40 bg-amber-300/10 text-amber-200"]
        : cash.charged === 0 && cash.free > 0
          ? ["Бесплатно", "border-sky-400/30 bg-sky-400/10 text-sky-300"]
          : ["Оплачено", "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${color} ${
        open ? "ring-1 ring-white/30" : ""
      }`}
    >
      {text}
    </button>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Окно оплаты игрока: что начислено (с отметкой «бесплатно»), оплаты, принять оплату */
export function CashPanel({
  name,
  cash,
  busy,
  onPay,
  onCancelPayment,
  onSetFree,
}: {
  name: string;
  cash: PlayerCash;
  busy: boolean;
  onPay: (amount: number, method: PayMethod) => void;
  onCancelPayment: (paymentId: number) => void;
  onSetFree: (eventId: number, free: boolean) => void;
}) {
  const [amount, setAmount] = useState(cash.debt > 0 ? String(cash.debt) : "");
  const value = Number(amount) || 0;

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-white/[0.08] bg-black/20 p-3 text-sm">
      <div>
        <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Начислено</div>
        {cash.charges.map((c) => (
          <div key={c.eventId} className="flex items-center gap-2 py-1">
            <div className={`min-w-0 flex-1 ${c.free ? "text-slate-500 line-through" : ""}`}>
              {CHARGE_LABEL[c.type]} · {formatRub(c.price)}
            </div>
            <Button
              variant={c.free ? "primary" : "ghost"}
              disabled={busy}
              onClick={() => onSetFree(c.eventId, !c.free)}
              title={c.free ? "Снять отметку «бесплатно»" : "Сделать бесплатным"}
            >
              {c.free ? "Бесплатно ✓" : "Бесплатно"}
            </Button>
          </div>
        ))}
        <div className="flex justify-between border-t border-white/[0.06] pt-1 font-semibold">
          <span>К оплате</span>
          <span className="tabular-nums">{formatRub(cash.charged)}</span>
        </div>
      </div>

      {cash.payments.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">Оплаты</div>
          {cash.payments.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1">
              <div className="min-w-0 flex-1 tabular-nums">
                {formatRub(p.amount)} · {PAY_METHOD_LABEL[p.method].toLowerCase()} · {time(p.at)}
              </div>
              <Button
                variant="ghost"
                disabled={busy}
                title="Отменить оплату"
                onClick={() => window.confirm(`Отменить оплату ${formatRub(p.amount)} от ${name}?`) && onCancelPayment(p.id)}
              >
                ↺
              </Button>
            </div>
          ))}
        </div>
      )}

      {cash.debt > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-slate-400">Принять</span>
            <input
              className={inputClass}
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            />
            <span className="shrink-0 text-slate-400">₽</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PAY_METHODS.map((m) => (
              <Button key={m} variant="primary" disabled={busy || value <= 0 || value > cash.debt} onClick={() => onPay(value, m)}>
                {PAY_METHOD_LABEL[m]}
              </Button>
            ))}
          </div>
          {value > cash.debt && <div className="text-xs text-red-300">Больше, чем долг: {formatRub(cash.debt)}</div>}
        </div>
      ) : cash.debt < 0 ? (
        <div className="text-xs text-amber-200">
          Переплата {formatRub(-cash.debt)}: оплачено больше, чем начислено (вход отменили или сделали бесплатным). Вернули деньги — отмените оплату (↺).
        </div>
      ) : (
        <div className="text-xs text-emerald-300">Всё оплачено</div>
      )}
    </div>
  );
}

/**
 * «Пришёл» и «Пришёл + оплатил»: второе — сначала выбрать, как заплатил (наличные / карта / перевод).
 * Без цены входа — только «Пришёл».
 */
export function EnterButtons({
  busy,
  withPay,
  onEnter,
}: {
  busy: boolean;
  withPay: boolean;
  onEnter: (pay?: PayMethod) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  if (choosing) {
    return (
      <>
        {PAY_METHODS.map((m) => (
          <Button key={m} variant="primary" disabled={busy} onClick={() => onEnter(m)}>
            {m === "cash" ? "Нал" : PAY_METHOD_LABEL[m]}
          </Button>
        ))}
        <Button variant="ghost" disabled={busy} onClick={() => setChoosing(false)} title="Отмена">
          ✕
        </Button>
      </>
    );
  }
  return (
    <>
      {withPay && (
        <Button disabled={busy} onClick={() => setChoosing(true)} title="Пришёл и сразу оплатил">
          +₽
        </Button>
      )}
      <Button variant="primary" disabled={busy} onClick={() => onEnter()}>
        Пришёл
      </Button>
    </>
  );
}

/** Итог кассы турнира: собрано, долги, по способам оплаты */
export function CashLine({ summary }: { summary: CashSummary }) {
  if (summary.charged === 0 && summary.paid === 0 && summary.free === 0) return null;
  const methods = PAY_METHODS.filter((m) => summary.byMethod[m] > 0).map(
    (m) => `${PAY_METHOD_LABEL[m].toLowerCase()} ${formatRub(summary.byMethod[m])}`,
  );
  return (
    <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>
          Собрано <b className="tabular-nums">{formatRub(summary.paid)}</b>
          <span className="text-slate-500"> из {formatRub(summary.charged)}</span>
        </span>
        {summary.debt > 0 ? (
          <span className="text-red-300">
            Долги <b className="tabular-nums">{formatRub(summary.debt)}</b> ({summary.debtors})
          </span>
        ) : (
          <span className="text-emerald-300">Долгов нет</span>
        )}
      </div>
      {(methods.length > 0 || summary.free > 0 || summary.overpaid > 0) && (
        <div className="mt-0.5 text-xs text-slate-500">
          {[...methods, summary.free > 0 && `бесплатно ${formatRub(summary.free)}`, summary.overpaid > 0 && `переплата ${formatRub(summary.overpaid)}`]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

const day = (at: number) => new Date(at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

/** Долг с прошлых турниров: «Долг 1 000 ₽ с 25.10» */
export function OldDebtBadge({ debts, open, onClick }: { debts: PlayerDebt[]; open: boolean; onClick: () => void }) {
  if (debts.length === 0) return null;
  const total = debts.reduce((s, d) => s + d.debt, 0);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-1 inline-flex items-center rounded-full border border-dashed border-red-400/60 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-300 ${
        open ? "ring-1 ring-white/30" : ""
      }`}
    >
      Долг {formatRub(total)} с {day(debts[0].date)}
    </button>
  );
}

/** Долги с прошлых турниров: по каждому — принять всю сумму наличными / картой / переводом */
export function OldDebtsPanel({
  debts,
  busy,
  onPay,
  title = "Долг с прошлых турниров",
}: {
  debts: PlayerDebt[];
  busy: boolean;
  title?: string;
  onPay: (tournamentId: number, amount: number, method: PayMethod) => void;
}) {
  if (debts.length === 0) return null;
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-red-400/30 bg-red-500/[0.06] p-3 text-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-red-300">{title}</div>
      {debts.map((d) => (
        <div key={d.tournamentId} className="space-y-1">
          <div className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {day(d.date)} · {d.name}
            </span>
            <b className="shrink-0 tabular-nums">{formatRub(d.debt)}</b>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {PAY_METHODS.map((m) => (
              <Button key={m} disabled={busy} onClick={() => onPay(d.tournamentId, d.debt, m)}>
                {PAY_METHOD_LABEL[m]}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Предупреждение о долгах для текущего турнира (запрос к серверу) — для кнопки «Завершить» на часах */
export async function fetchDebtWarning() {
  try {
    const res = await fetch("/api/tournament/players", { cache: "no-store" });
    return res.ok ? debtWarning((await res.json()).cash) : "";
  } catch {
    return "";
  }
}
