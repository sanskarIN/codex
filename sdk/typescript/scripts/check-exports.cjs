// Validate the packaged SDK export conditions without downloading a Codex CLI binary.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const manifest = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const tsc = require.resolve("typescript/bin/tsc");
const root = mkdtempSync(path.join(tmpdir(), "codex-esm-exports-"));

try {
  const sdkDir = path.join(root, "node_modules", "@openai", "codex-sdk");
  mkdirSync(path.join(sdkDir, "dist"), { recursive: true });
  writeFileSync(
    path.join(sdkDir, "package.json"),
    JSON.stringify({ name: manifest.name, type: manifest.type, exports: manifest.exports }),
  );
  writeFileSync(path.join(sdkDir, "dist", "index.d.ts"), "export declare class Codex {}\n");
  writeFileSync(path.join(sdkDir, "dist", "index.js"), "export class Codex {}\n");
  const importer = 'import { Codex } from "@openai/codex-sdk"; console.log(Codex);\n';
  for (const ext of ["cts", "mts"]) {
    writeFileSync(path.join(root, `repro.${ext}`), importer);
  }
  function checkTypeScript(ext) {
    return spawnSync(
      process.execPath,
      [
        tsc,
        "--strict",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ES2022",
        "--noEmit",
        `repro.${ext}`,
      ],
      { cwd: root, encoding: "utf8" },
    );
  }
  const commonJs = checkTypeScript("cts");
  const esm = checkTypeScript("mts");
  assert.equal(esm.status, 0, `ESM import must typecheck: ${esm.stdout}${esm.stderr}`);
  assert.notEqual(commonJs.status, 0, "CommonJS imports must not typecheck as ESM-only");
  assert.match(commonJs.stdout + commonJs.stderr, /@openai\/codex-sdk/);

  const runtime = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { Codex } from "@openai/codex-sdk"; if (typeof Codex !== "function") process.exit(1);',
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    runtime.status,
    0,
    `ESM runtime import must succeed: ${runtime.stdout}${runtime.stderr}`,
  );
  console.log("Package exports validated for ESM and CommonJS TypeScript consumers");
} finally {
  rmSync(root, { recursive: true, force: true });
}
