import { readFile } from "node:fs/promises";

import { describe, expect, it } from "@jest/globals";

import type { CodexConfigObject } from "../src/codexOptions";
import { CodexExec } from "../src/exec";
import { createOutputSchemaFile } from "../src/outputSchemaFile";

async function executeWithConfig(config: CodexConfigObject): Promise<void> {
  const exec = new CodexExec("codex", {}, config);
  for await (const _event of exec.run({ input: "test" })) {
    // Non-plain configurations must be rejected before spawning a process.
  }
}

describe("structured input object validation", () => {
  it.each([
    ["Date", new Date("2026-01-01T00:00:00Z")],
    ["Map", new Map([["name", "value"]])],
    ["RegExp", /pattern/],
    ["class instance", new (class Example { value = "test"; })()],
  ])("rejects %s as a top-level output schema", async (_name, value) => {
    await expect(createOutputSchemaFile(value)).rejects.toThrow(
      "outputSchema must be a plain JSON object",
    );
  });

  it("accepts ordinary and null-prototype output schema objects", async () => {
    const schema = Object.assign(Object.create(null) as Record<string, unknown>, {
      type: "object",
    });
    const output = await createOutputSchemaFile(schema);
    try {
      expect(output.schemaPath).toBeDefined();
      expect(JSON.parse(await readFile(output.schemaPath!, "utf8"))).toEqual({
        type: "object",
      });
    } finally {
      await output.cleanup();
    }
  });

  it.each([
    ["Date", new Date("2026-01-01T00:00:00Z")],
    ["Map", new Map([["name", "value"]])],
    ["RegExp", /pattern/],
  ])("rejects %s as a top-level config object", async (_name, value) => {
    await expect(executeWithConfig(value as unknown as CodexConfigObject)).rejects.toThrow(
      "Codex config overrides must be a plain object",
    );
  });

  it("rejects non-plain nested config values instead of silently flattening them", async () => {
    await expect(
      executeWithConfig({
        features: {
          bad: new Date("2026-01-01T00:00:00Z"),
        },
      } as unknown as CodexConfigObject),
    ).rejects.toThrow("Unsupported Codex config override value at features.bad: object");
  });
});
