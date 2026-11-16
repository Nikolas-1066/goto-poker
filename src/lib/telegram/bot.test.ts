import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAction } from "../clock";
import { confirmRequest, listRequests, register, rejectRequest, sessionAccount } from "../db/accounts";
import { createPlayer } from "../db/players";
import { addItem, linkOpened, markOpened } from "../db/schedule";
import { listSignups, signUp, syncSignups } from "../db/signups";
import { loadState, openStore, transaction, writeState } from "../db/sqlite";
import { accountByTelegram, announce, createLinkCode, markSent, pendingOutbox, roleOfPlayer, setRole } from "../db/telegram";
import { askComing, dropLate, remindToday, sendResults, staffReports } from "../db/telegramJobs";
import { applyPlayerAction, archiveCurrentIfUsed, currentTournament, listParticipants } from "../db/tournament";
import { openedTournament } from "../schedule";
import type { Db } from "../types";
import { BotError, handleUpdate, type BotReply, type TgUpdate } from "./bot";
import { MENU } from "./texts";

const NOW = Date.UTC(2026, 10, 13, 12, 0); // пятница 13 ноября, 15:00 в клубе
const TODAY = "2026-11-13";

let dir: string;
let db: DatabaseSync;
let presetId: string;
let seq = 0;
const ids: Record<string, number> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-bot-"));
  db = openStore(dir, NOW - 86_400_000).db;
  presetId = (db.prepare("SELECT id FROM presets LIMIT 1").get() as { id: string }).id;
  for (const [i, name] of ["Саша", "Ира", "Олег"].entries()) ids[name] = createPlayer(db, { name, phone: `+7900000000${i}` }).id;
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = <T,>(fn: (next: Db) => T, edit: (next: Db) => void = () => {}): T => {
  const before = loadState(db);
  const next = structuredClone(before);
  edit(next);
  let out!: T;
  transaction(db, () => {
    out = fn(next);
    writeState(db, before, next);
  });
  return out;
};
const bot = (update: Omit<TgUpdate, "update_id">, now = NOW): BotReply => write((next) => handleUpdate(db, next, { update_id: ++seq, ...update }, now));
const text = (from: number, t: string, now = NOW) => bot({ message: { chat: { id: from, type: "private" }, from: { id: from, first_name: "Алекс" }, text: t } }, now);
const contact = (from: number, phone: string, owner = from) =>
  bot({ message: { chat: { id: from, type: "private" }, from: { id: from, first_name: "Алекс" }, contact: { phone_number: phone, user_id: owner } } });
const press = (from: number, data: string, now = NOW) => bot({ callback_query: { id: "cb", from: { id: from }, data, message: { chat: { id: from } } } }, now);
const item = (seatLimit: number | "" = "", date = "2026-11-20") => addItem(db, { date, time: "19:00", name: "Пятничный", presetId, seatLimit, note: "" }, TODAY, NOW);
const outbox = () => pendingOutbox(db, NOW + 1000).map((m) => [m.chatId, m.text]);

describe("привязка Telegram", () => {
  it("незнакомцу — приветствие и кнопка «Поделиться номером»; чужой контакт не принимается", () => {
    const hello = text(100, "/start");
    expect(hello.messages[0]).toMatchObject({ chatId: 100, keyboard: "contact" });
    expect(contact(100, "79000000000", 555).messages[0].text).toContain("именно ваш номер");
    expect(accountByTelegram(db, 100)).toBeNull();
  });

  it("номер есть в базе — привязка сразу, без админа; меню работает", () => {
    const r = contact(100, "79000000000");
    expect(r.messages[0]).toMatchObject({ keyboard: "menu" });
    expect(r.messages[0].text).toContain("Готово, Саша");
    expect(accountByTelegram(db, 100)).toMatchObject({ playerId: ids["Саша"] });
    expect(listRequests(db)).toEqual([]);
    expect(text(100, MENU.rating).messages[0].text).toContain("🏆 Саша");
  });

  it("номера в базе нет — заявка админу, админам уходит сообщение; записываться уже можно", () => {
    contact(200, "79000000001"); // Ира — будет админом
    setRole(db, ids["Ира"], "admin", NOW);
    const r = contact(100, "+7 999 555-66-77");
    expect(r.messages[0].text).toContain("заявка отправлена администратору");
    expect(listRequests(db)).toMatchObject([{ name: "Алекс", phone: "+79995556677", match: null }]);
    expect(outbox()).toEqual([[200, expect.stringContaining("Заявка на вход (из бота): Алекс")]]);
    expect(text(100, MENU.rating).messages[0].text).toContain("подтвердит вашу заявку");
  });

  it("заявку подтвердили — у админа то же сообщение исправляется на «✅ Подтверждена», игроку — «заявка подтверждена»", () => {
    contact(200, "79000000001");
    setRole(db, ids["Ира"], "admin", NOW);
    contact(100, "+7 999 555-66-77"); // новичок — заявка
    const [msg] = pendingOutbox(db, NOW + 1000);
    expect(msg).toMatchObject({ chatId: 200, editMessageId: null });
    markSent(db, msg.id, NOW + 1000, 777); // Telegram вернул номер сообщения
    const acc = accountByTelegram(db, 100)!;
    confirmRequest(db, acc.id, null, NOW + 2000);
    const out = pendingOutbox(db, NOW + 3000);
    expect(out).toEqual([
      expect.objectContaining({ chatId: 200, editMessageId: 777, text: expect.stringMatching(/Заявка на вход[\s\S]*\n\n✅ Подтверждена: новый игрок «Алекс»$/) }),
      expect.objectContaining({ chatId: 100, editMessageId: null, text: expect.stringContaining("ваша заявка подтверждена") }),
    ]);
  });

  it("заявку отклонили, пока сообщение ещё не ушло, — уходит сразу с пометкой «❌ Отклонена»", () => {
    contact(200, "79000000001");
    setRole(db, ids["Ира"], "admin", NOW);
    contact(100, "+7 999 555-66-77");
    rejectRequest(db, accountByTelegram(db, 100)!.id, NOW + 1000);
    expect(pendingOutbox(db, NOW + 2000)).toEqual([expect.objectContaining({ chatId: 200, editMessageId: null, text: expect.stringMatching(/❌ Отклонена$/) })]);
    expect(accountByTelegram(db, 100)).toBeNull();
  });

  it("ссылка из кабинета: одноразовый код привязывает чат к входу с сайта", () => {
    const token = register(db, { name: "Саша", phone: "+79000000000", password: "секрет1" }, NOW);
    const acc = sessionAccount(db, token, NOW)!;
    confirmRequest(db, acc.id, null, NOW);
    const code = createLinkCode(db, acc.id, NOW);
    expect(text(100, `/start ${code}`).messages[0].text).toContain("Готово, Саша");
    expect(accountByTelegram(db, 100)?.id).toBe(acc.id);
    expect(text(300, `/start ${code}`).messages[0]).toMatchObject({ keyboard: "contact" }); // код уже использован
    expect(accountByTelegram(db, 300)).toBeNull();
  });

  it("роль в боте — только тому, у кого подключён Telegram", () => {
    expect(() => setRole(db, ids["Саша"], "owner", NOW)).toThrow("не подключён Telegram");
    contact(100, "79000000000");
    setRole(db, ids["Саша"], "owner", NOW);
    expect(roleOfPlayer(db, ids["Саша"])).toEqual({ linked: true, role: "owner" });
  });
});

describe("запись в боте", () => {
  it("расписание → «Записаться» → гости → записан; мои записи → отмена", () => {
    const it1 = item();
    contact(100, "79000000000");
    const list = text(100, MENU.schedule).messages[0];
    expect(list.text).toContain("Пятничный");
    expect(list.buttons).toEqual([[{ text: "Записаться: пт, 20 ноября, 19:00", data: `s:${it1.id}` }]]);
    expect(press(100, `s:${it1.id}`).messages[0].buttons![0].map((b) => b.data)).toEqual([0, 1, 2, 3].map((n) => `g:${it1.id}:${n}`));
    expect(press(100, `g:${it1.id}:2`).messages[0].text).toBe("✅ Вы записаны: Пятничный, пт, 20 ноября, 19:00. С вами гостей: 2.");
    expect(listSignups(db, it1)).toMatchObject([{ name: "Саша", guests: 2, state: "going" }]);
    expect(text(100, MENU.schedule).messages[0].text).toContain("✅ вы записаны");

    const mine = text(100, MENU.mine).messages[0];
    expect(mine.buttons).toEqual([[{ text: "Отменить: пт, 20 ноября, 19:00", data: `c:${it1.id}` }]]);
    expect(press(100, `c:${it1.id}`).messages[0].text).toContain("Запись отменена");
    expect(listSignups(db, it1)).toEqual([]);
  });

  it("мест нет — лист ожидания; место освободилось — бот пишет «вы записаны»", () => {
    const it1 = item(2);
    contact(100, "79000000000");
    contact(200, "79000000001");
    press(100, `g:${it1.id}:1`); // с гостем — оба места заняты
    expect(press(200, `g:${it1.id}:0`).messages[0].text).toContain("листе ожидания, номер 1");
    press(100, `c:${it1.id}`);
    expect(outbox()).toEqual([[200, "🎉 Освободилось место — вы записаны: Пятничный, пт, 20 ноября, 19:00."]]);
  });

  it("запись закрыта — понятная ошибка, ничего не записано", () => {
    const it1 = item("", TODAY);
    contact(100, "79000000000");
    const late = Date.UTC(2026, 10, 13, 16, 30);
    expect(() => press(100, `g:${it1.id}:0`, late)).toThrow(BotError);
    expect(listSignups(db, it1)).toEqual([]);
  });
});

describe("сообщения от бота", () => {
  const open = (id: number, now = NOW) => {
    const row = db.prepare("SELECT name, preset_id FROM schedule WHERE id = ?").get(id) as { name: string; preset_id: string };
    write(
      () => {
        markOpened(db, id, now);
        archiveCurrentIfUsed(db, now);
      },
      (d) => {
        d.tournament = openedTournament(d.tournament, { name: row.name, presetId: row.preset_id }, now, (pid) => d.presets.find((p) => p.id === pid));
      },
    );
    linkOpened(db, id);
    write((next) => syncSignups(db, next, id, now));
  };
  const act = (action: Parameters<typeof applyPlayerAction>[2], now: number) => write((next) => applyPlayerAction(db, next, action, now));
  const clock = (action: Parameters<typeof applyAction>[1], now: number) =>
    write(
      () => {},
      (d) => {
        d.tournament = applyAction(d.tournament, action, now, () => undefined);
      },
    );
  const names = () => listParticipants(db, currentTournament(db).id).map((p) => [p.name, p.status]);

  it("напоминание в день турнира: с 11:00, только записанным, один раз", () => {
    const it1 = item("", TODAY);
    contact(100, "79000000000");
    contact(200, "79000000001");
    press(100, `g:${it1.id}:1`);
    expect(remindToday(db, Date.UTC(2026, 10, 13, 7, 0))).toBe(0); // 10:00 — рано
    expect(remindToday(db, NOW)).toBe(1);
    expect(remindToday(db, NOW + 60_000)).toBe(0);
    expect(outbox()).toEqual([[100, expect.stringContaining("сегодня в 19:00 — Пятничный. Вы записаны (гостей с вами: 1)")]]);
  });

  it("«вы придёте?» после первого перерыва; регистрация закрылась — не пришедший снят и получил сообщение", () => {
    const it1 = item("", TODAY);
    contact(100, "79000000000");
    press(100, `g:${it1.id}:0`);
    signUp(db, it1.id, { playerId: ids["Ира"] }, {}, NOW);
    open(it1.id);
    act({ type: "enter", playerId: ids["Ира"] }, NOW);
    act({ type: "enter", playerId: ids["Олег"] }, NOW);
    clock({ type: "start" }, NOW);
    expect(names().sort()).toEqual([["Ира", "playing"], ["Олег", "playing"], ["Саша", "registered"]]);

    const t = () => loadState(db).tournament;
    const steps = t().structure!.steps;
    const until = t().structure!.rebuyUntilLevel;
    expect(until).toBeGreaterThan(0);
    const firstBreak = steps.findIndex((s) => s.kind === "break");
    const jump = (index: number, now: number) => write(() => {}, (d) => {
      d.tournament = { ...d.tournament, stepIndex: index, stepEndsAt: now + 60_000 };
    });

    expect(askComing(db, t(), NOW + 1000)).toBe(0); // первый перерыв ещё не прошёл
    jump(firstBreak + 1, NOW + 2000);
    expect(askComing(db, t(), NOW + 3000)).toBe(1);
    expect(askComing(db, t(), NOW + 4000)).toBe(0);
    expect(pendingOutbox(db, NOW + 5000).at(-1)).toMatchObject({ chatId: 100, text: "Турнир «Пятничный» уже идёт, а вас ещё нет. Вы придёте?" });
    expect(press(100, `come:${currentTournament(db).id}`, NOW + 5000).messages[0].text).toContain("ждём вас");

    // пока идёт ребай и уровень «дозаписи» — никого не снимаем
    expect(write((next) => dropLate(db, next, NOW + 6000))).toBe(0);
    // через два уровня после закрытия ребаев регистрация закрыта совсем
    let levels = 0;
    const closed = steps.findIndex((s) => s.kind === "level" && ++levels === until + 2);
    jump(closed, NOW + 7000);
    expect(write((next) => dropLate(db, next, NOW + 8000))).toBe(1);
    expect(names().sort()).toEqual([["Ира", "playing"], ["Олег", "playing"]]);
    expect(listSignups(db, it1).map((s) => s.name)).toEqual(["Ира"]);
    expect(pendingOutbox(db, NOW + 9000).at(-1)).toMatchObject({ chatId: 100, text: expect.stringContaining("ваша запись снята") });
  });

  it("турнир завершён: админам — места и нокауты, владельцу — ещё и отчёт с кассой; итоги игрокам — кнопкой", () => {
    contact(100, "79000000000");
    contact(200, "79000000001");
    setRole(db, ids["Саша"], "owner", NOW);
    setRole(db, ids["Ира"], "admin", NOW);
    write(() => {}, (d) => {
      d.tournament = { ...applyAction(d.tournament, { type: "loadPreset", presetId }, NOW, (id) => d.presets.find((p) => p.id === id)), mode: "players" };
    });
    act({ type: "setSeating", autoSeat: false }, NOW);
    for (const n of ["Саша", "Ира", "Олег"]) act({ type: "enter", playerId: ids[n] }, NOW);
    clock({ type: "start" }, NOW);
    const pid = (n: string) => listParticipants(db, currentTournament(db).id).find((p) => p.name === n)!.id;
    act({ type: "bust", busted: [{ participantId: pid("Олег"), handOrder: 1 }], knockers: [pid("Саша")] }, NOW + 1000);
    act({ type: "bust", busted: [{ participantId: pid("Ира"), handOrder: 1 }], knockers: [pid("Саша")] }, NOW + 2000);
    expect(staffReports(db, NOW + 2500)).toBe(0); // ещё не завершён
    act({ type: "finish" }, NOW + 3000);

    expect(staffReports(db, NOW + 4000)).toBe(3); // двоим — места, владельцу — ещё отчёт
    expect(staffReports(db, NOW + 5000)).toBe(0);
    const sent = pendingOutbox(db, NOW + 6000);
    expect(sent.filter((m) => m.chatId === 200).map((m) => m.text)).toEqual([expect.stringContaining("1. Саша — KO 2")]);
    expect(sent.filter((m) => m.chatId === 200)[0].text).not.toContain("КАССА");
    expect(sent.filter((m) => m.chatId === 100).map((m) => m.text.includes("КАССА"))).toEqual([false, true]);
    expect(staffReports(db, NOW + 13 * 3_600_000)).toBe(0); // старые турниры не рассылаются

    const tid = currentTournament(db).id;
    expect(sendResults(db, tid, NOW + 7000)).toEqual({ sent: 2, linked: 2, players: 3 });
    expect(sendResults(db, tid, NOW + 8000)).toMatchObject({ sent: 0 });
    const results = pendingOutbox(db, NOW + 9000).slice(-2).map((m) => m.text);
    expect(results.find((t) => t.includes("Ваше место: 2 из 3"))).toContain("🏆 Новые достижения: 🎟 Первый турнир");
    // победитель с двумя нокаутами: первый турнир и первая победа
    expect(results.find((t) => t.includes("Ваше место: 1 из 3"))).toContain("🎟 Первый турнир, 🥇 Первая победа");
  });

  it("анонс — всем, у кого подключён Telegram", () => {
    expect(() => announce(db, "Турнир!", NOW)).toThrow("отправлять некому");
    contact(100, "79000000000");
    contact(200, "79000000001");
    expect(() => announce(db, "  ", NOW)).toThrow("Впишите текст");
    expect(announce(db, "В субботу большой турнир!", NOW)).toBe(2);
    expect(outbox()).toEqual([[100, "В субботу большой турнир!"], [200, "В субботу большой турнир!"]]);
  });
});
