"use client";

// Отчёт владельцу после турнира: текст для мессенджера (кнопка «Скопировать») и картинки.
// В баре админка открыта по http://IP — браузер там не даёт сайту доступ к буферу обмена и «Поделиться»,
// поэтому копируем старым способом через выделенное текстовое поле, а картинки — «нажать и подержать».

import { TelegramSend } from "./Telegram";
import { useCallback, useEffect, useState } from "react";
import { reportText, type TournamentReport } from "@/lib/report";
import { ReportImages } from "./ReportImages";
import { Button } from "./ui";

type Data = { report: TournamentReport; sent: boolean };

/** Скопировать текст: современный способ, а если он недоступен (http в баре) — через выделение */
async function copyText(text: string) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ниже — запасной способ
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

/**
 * Кнопка «Отчёт для владельца» и окно отчёта. tournamentId — турнир из «Истории»;
 * без него — текущий (только что завершённый). remind — жёлтая плашка, пока отчёт не скопирован.
 */
export function ReportBlock({ tournamentId, remind = false }: { tournamentId?: number; remind?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/report${tournamentId ? `?id=${tournamentId}` : ""}`, { cache: "no-store" });
    const d = await res.json();
    if (!res.ok) return setError(d.error ?? "Не удалось собрать отчёт");
    setError("");
    setData(d);
  }, [tournamentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const markSent = useCallback(async () => {
    if (!data || data.sent) return;
    await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: data.report.tournament.id }) });
    setData({ ...data, sent: true });
  }, [data]);

  if (error) return <div className="text-sm text-red-300">{error}</div>;
  if (!data) return null;

  return (
    <>
      {remind && !data.sent && (
        <div className="mb-2 rounded-lg border border-amber-300/40 bg-amber-300/[0.08] px-3 py-2 text-sm text-amber-200">
          Не забудьте отправить отчёт владельцу: места, кассу и рейтинг.
        </div>
      )}
      <Button variant={remind && !data.sent ? "primary" : "default"} className="w-full sm:w-auto" onClick={() => setOpen(true)}>
        📋 Отчёт для владельца
      </Button>
      <div className="mt-2">
        <TelegramSend kind="results" tournamentId={data.report.tournament.id} />
      </div>
      {open && <ReportPanel report={data.report} onCopied={markSent} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportPanel({ report, onCopied, onClose }: { report: TournamentReport; onCopied: () => void; onClose: () => void }) {
  const text = reportText(report);
  const [copied, setCopied] = useState<boolean | null>(null);

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#080e15] p-3 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold">Отчёт · {report.tournament.name}</h2>
          <Button onClick={onClose}>✕ Закрыть</Button>
        </div>

        <div className="rounded-xl border border-white/[0.09] bg-[#101923] p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-300">Текст для владельца</div>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-sans text-sm text-slate-200">{text}</pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                const ok = await copyText(text);
                setCopied(ok);
                if (ok) onCopied();
              }}
            >
              Скопировать
            </Button>
            {copied === true && <span className="text-sm text-emerald-300">Скопировано — вставьте в чат с владельцем</span>}
            {copied === false && (
              <span className="text-sm text-amber-200">Не получилось скопировать — выделите текст выше пальцем и скопируйте</span>
            )}
          </div>
        </div>

        <ReportImages report={report} onSaved={onCopied} />
      </div>
    </div>
  );
}
