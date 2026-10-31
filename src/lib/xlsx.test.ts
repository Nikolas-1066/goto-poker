import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildXlsx, colName } from "./xlsx";

describe("файл Excel", () => {
  it("буквы колонок", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(colName)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("правильный zip: листы, кириллица, числа, спецсимволы", () => {
    const buf = buildXlsx([
      { name: "Сводка", rows: [["Показатель", "Значение"], ["Собрано, ₽", 24900], ["Игрок <&> \"кавычки\"", null]] },
      { name: "Касса/долги", rows: [["Сумма"], [1500]] },
    ]);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goto-xlsx-"));
    const file = path.join(dir, "t.xlsx");
    fs.writeFileSync(file, buf);
    // системный unzip проверяет контрольные суммы и распаковывает
    expect(execFileSync("unzip", ["-tq", file]).toString()).toContain("No errors");
    const sheet1 = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"]).toString();
    expect(sheet1).toContain("<t xml:space=\"preserve\">Собрано, ₽</t>");
    expect(sheet1).toContain("<v>24900</v>");
    expect(sheet1).toContain("Игрок &lt;&amp;&gt; &quot;кавычки&quot;");
    const workbook = execFileSync("unzip", ["-p", file, "xl/workbook.xml"]).toString();
    expect(workbook).toContain('name="Сводка"');
    expect(workbook).toContain('name="Касса долги"'); // «/» в имени листа нельзя
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
