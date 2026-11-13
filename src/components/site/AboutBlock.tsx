"use client";

// «О клубе»: адрес, как добраться, контакты, текст и правила. Заполняется в админке («Расписание» → «О клубе»).

import { aboutIsEmpty, type SiteAbout } from "@/lib/site";
import { Muted, Panel, useSite } from "./SiteShell";

const Lines = ({ text }: { text: string }) => <div className="whitespace-pre-line text-sm leading-relaxed text-slate-200">{text}</div>;

/** Кнопки-ссылки на Telegram и ВК клуба */
export function ClubLinks({ about }: { about: SiteAbout }) {
  if (!about.telegram && !about.vk) return null;
  const cls = "rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/[0.08]";
  return (
    <div className="flex flex-wrap gap-2">
      {about.telegram && (
        <a href={about.telegram} target="_blank" rel="noreferrer" className={cls}>
          Telegram ↗
        </a>
      )}
      {about.vk && (
        <a href={about.vk} target="_blank" rel="noreferrer" className={cls}>
          ВКонтакте ↗
        </a>
      )}
    </div>
  );
}

export function AboutBlock({ brief = false }: { brief?: boolean }) {
  const { data: about, loading } = useSite<SiteAbout>("about");
  if (loading) return <Muted>Загрузка…</Muted>;
  if (!about || aboutIsEmpty(about)) return brief ? null : <Muted>Информация о клубе скоро появится.</Muted>;

  const contacts = (about.address || about.how || about.phone || about.telegram || about.vk) && (
    <Panel title="Где мы">
      <div className="space-y-2">
        {about.address && <div className="text-lg font-bold">{about.address}</div>}
        {about.how && <Lines text={about.how} />}
        {about.phone && (
          <div className="text-sm text-slate-300">
            Телефон:{" "}
            <a href={`tel:${about.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-amber-200 hover:underline">
              {about.phone}
            </a>
          </div>
        )}
        <ClubLinks about={about} />
      </div>
    </Panel>
  );
  if (brief) return contacts || null;
  return (
    <div className="space-y-4">
      {about.about && (
        <Panel title="О клубе">
          <Lines text={about.about} />
        </Panel>
      )}
      {contacts}
      {about.rules && (
        <Panel title="Правила клуба">
          <Lines text={about.rules} />
        </Panel>
      )}
    </div>
  );
}
