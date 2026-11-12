import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Собранный Windows-пакет и кэш сборки — не наш исходный код
    "dist/**",
    // Скрипт для UPDATE.bat на ноутбуке — запускается голым node.exe (CommonJS), не часть приложения
    "deploy/windows/scripts/*.cjs",
    "deploy/.cache/**",
  ]),
]);

export default eslintConfig;
