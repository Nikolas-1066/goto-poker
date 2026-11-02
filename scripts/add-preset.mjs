// Добавить пресет из JSON-файла в базу табло.
// ВАЖНО: перед запуском остановите табло (npm run dev / «Выключить табло»).
//
//   Mac:      node scripts/add-preset.mjs docs/presets/goto-vecherniy.json
//   Ноутбук:  system\node.exe add-preset.mjs goto-vecherniy.json data\goto-poker.db
//
// Если пресет с таким же названием уже есть — он будет обновлён.
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const [file, dbPath = "data/goto-poker.db"] = process.argv.slice(2);
if (!file) {
  console.error("Укажите файл пресета: node add-preset.mjs пресет.json [путь к базе]");
  process.exit(1);
}
if (!existsSync(dbPath)) {
  console.error(`Не найдена база ${dbPath}. Сначала хотя бы раз запустите табло.`);
  process.exit(1);
}

const p = JSON.parse(readFileSync(file, "utf8"));
const id = () => randomBytes(6).toString("hex");
const steps = p.steps.map((s) => ({ ...s, id: id() }));

const db = new DatabaseSync(dbPath);
const existing = db.prepare("SELECT id FROM presets WHERE name = ?").get(p.name);
const order = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM presets").get().n;
const row = {
  id: existing?.id ?? id(),
  name: p.name,
  description: p.description ?? null,
  starting_stack: p.startingStack,
  rebuy_stack: p.rebuyStack,
  addon_stack: p.addonStack,
  double_addon_stack: p.doubleAddonStack,
  rebuy_until_level: p.rebuyUntilLevel,
  addon_until_level: p.addonUntilLevel,
  prices_json: JSON.stringify(p.prices ?? {}),
  steps_json: JSON.stringify(steps),
  sort_order: order,
  updated_at: Date.now(),
};
if (existing) {
  db.prepare(`UPDATE presets SET description=:description, starting_stack=:starting_stack,
    rebuy_stack=:rebuy_stack, addon_stack=:addon_stack, double_addon_stack=:double_addon_stack,
    rebuy_until_level=:rebuy_until_level, addon_until_level=:addon_until_level,
    prices_json=:prices_json, steps_json=:steps_json, updated_at=:updated_at WHERE id=:id`)
    .run({ ...row, sort_order: undefined, name: undefined });
} else {
  db.prepare(`INSERT INTO presets (id, name, description, starting_stack, rebuy_stack, addon_stack,
    double_addon_stack, rebuy_until_level, addon_until_level, prices_json, steps_json, sort_order, updated_at)
    VALUES (:id, :name, :description, :starting_stack, :rebuy_stack, :addon_stack, :double_addon_stack,
    :rebuy_until_level, :addon_until_level, :prices_json, :steps_json, :sort_order, :updated_at)`).run(row);
}
db.close();
const levels = steps.filter((s) => s.kind === "level").length;
console.log(`✓ Пресет «${p.name}» ${existing ? "обновлён" : "добавлен"}: ${levels} уровней. Можно запускать табло.`);
