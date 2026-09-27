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
    // Vendored Draco decoder binaries, copied verbatim out of the three.js
    // distribution by scripts/sync-decoders.mjs. They are minified emscripten output,
    // not our source, and linting them is meaningless.
    "public/draco/**",
  ]),
]);

export default eslintConfig;
