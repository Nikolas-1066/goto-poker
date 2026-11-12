// Сводка по базе табло для UPDATE.bat: когда в ней было последнее действие, сколько игроков и турниров.
// Запуск: node inspect-db.cjs <путь к копии goto-poker.db>. Печатает одну строку JSON.
const { DatabaseSync } = require("node:sqlite");
try {
  const db = new DatabaseSync(process.argv[2]);
  const one = (sql) => {
    try {
      return Number(db.prepare(sql).get().v) || 0;
    } catch {
      return 0;
    }
  };
  db.prepare("SELECT COUNT(*) FROM sqlite_master").get(); // база читается и не повреждена
  const last = Math.max(
    one("SELECT MAX(at) AS v FROM audit_log"),
    one("SELECT MAX(at) AS v FROM events"),
    one("SELECT MAX(updated_at) AS v FROM tournaments"),
  );
  const players = one("SELECT COUNT(*) AS v FROM players");
  const tours = one("SELECT COUNT(DISTINCT tournament_id) AS v FROM events");
  const ok = one("SELECT COUNT(*) AS v FROM pragma_integrity_check WHERE integrity_check = 'ok'") === 1;
  console.log(JSON.stringify({ ok, last, players, tours }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message) }));
}
