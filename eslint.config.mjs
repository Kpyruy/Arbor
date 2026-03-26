import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  {
    ignores: [
      "node_modules/**",
      "main.js",
      "assets/**"
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: rootDir
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  }
]);
