"use client";

// «О клубе» для сайта (docs/SITE.md): адрес, как добраться, контакты, текст и правила.
// Что вписано — то и видно на сайте на главной и на странице «О клубе»; пустые поля не показываются.

import { useEffect, useState } from "react";
import { ABOUT_EMPTY, type SiteAbout } from "@/lib/site";
import { Button, Card, Field, inputClass } from "./ui";

export function AboutEditor() {
  const [saved, setSaved] = useState<SiteAbout | null>(null);
  const [draft, setDraft] = useState<SiteAbout>(ABOUT_EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    fetch("/api/site?get=about", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : ABOUT_EMPTY))
      .catch(() => ABOUT_EMPTY)
      .then((a: SiteAbout) => {
        setSaved(a);
        setDraft(a);
      });
  }, []);

  const set = (patch: Partial<SiteAbout>) => {
    setDraft({ ...draft, ...patch });
    setFlash("");
  };
  const changed = saved != null && JSON.stringify(saved) !== JSON.stringify(draft);

  async function save() {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      const res = await fetch("/api/site", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const d = await res.json();
      if (!res.ok) return setError(d.error ?? "Не получилось сохранить");
      setSaved(d);
      setDraft(d);
      setFlash("Сохранено — на сайте уже обновилось");
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  const area = `${inputClass} min-h-24 resize-y font-sans leading-relaxed`;
  return (
    <Card title="О клубе — для сайта">
      {saved == null ? (
        <div className="py-3 text-center text-sm text-slate-500">Загрузка…</div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <p className="text-sm text-slate-400">Это увидят все посетители сайта. Пустые поля на сайте не показываются.</p>
          <Field label="Адрес">
            <input className={inputClass} maxLength={200} placeholder="Воронеж, улица, дом" value={draft.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          <Field label="Как добраться">
            <textarea className={area} maxLength={500} placeholder="Вход со двора, второй этаж…" value={draft.how} onChange={(e) => set({ how: e.target.value })} />
          </Field>
          <Field label="Телефон">
            <input className={inputClass} maxLength={40} inputMode="tel" placeholder="+7 900 000-00-00" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Telegram (ссылка)">
              <input className={inputClass} maxLength={200} placeholder="https://t.me/…" value={draft.telegram} onChange={(e) => set({ telegram: e.target.value })} />
            </Field>
            <Field label="ВКонтакте (ссылка)">
              <input className={inputClass} maxLength={200} placeholder="https://vk.com/…" value={draft.vk} onChange={(e) => set({ vk: e.target.value })} />
            </Field>
          </div>
          <Field label="О клубе">
            <textarea className={area} maxLength={3000} placeholder="Пара абзацев о клубе" value={draft.about} onChange={(e) => set({ about: e.target.value })} />
          </Field>
          <Field label="Правила клуба">
            <textarea className={`${area} min-h-32`} maxLength={5000} placeholder="Каждое правило — с новой строки" value={draft.rules} onChange={(e) => set({ rules: e.target.value })} />
          </Field>
          {error && <div className="text-sm text-red-400">{error}</div>}
          {flash && <div className="text-sm text-emerald-300">{flash}</div>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={busy || !changed}>
              Сохранить
            </Button>
            <a href="/about" target="_blank" rel="noreferrer" className="text-sm text-slate-400 hover:text-slate-200">
              Посмотреть на сайте ↗
            </a>
          </div>
        </form>
      )}
    </Card>
  );
}
