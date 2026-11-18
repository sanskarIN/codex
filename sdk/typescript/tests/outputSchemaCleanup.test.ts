import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";
import type { CodexExec } from "../src/exec";
import { Thread, type Input } from "../src/thread";

function testThread(): Thread {
  const exec = {
    async *run(): AsyncGenerator<string> {
      yield JSON.stringify({ type: "thread.started", thread_id: "test-thread" });
      yield JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      });
    },
  } as unknown as CodexExec;
  return new Thread(exec, {}, {});
}

describe("output schema temp-directory cleanup", () => {
  it("does not allocate schema files when run receives an invalid input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-output-cleanup-test-"));
    const tmpdirSpy = jest.spyOn(os, "tmpdir").mockReturnValue(root);
    try {
      await expect(
        testThread().run(null as unknown as Input, {
          outputSchema: { type: "object" },
        }),
      ).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
    } finally {
      tmpdirSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not allocate schema files for invalid streamed input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-output-cleanup-test-"));
    const tmpdirSpy = jest.spyOn(os, "tmpdir").mockReturnValue(root);
    try {
      const streamed = await testThread().runStreamed(null as unknown as Input, {
        outputSchema: { type: "object" },
      });
      await expect(streamed.events.next()).rejects.toThrow();
      expect(await readdir(root)).toEqual([]);
    } finally {
      tmpdirSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cleans a valid streamed turn's temporary output schema", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codex-output-cleanup-test-"));
    const tmpdirSpy = jest.spyOn(os, "tmpdir").mockReturnValue(root);
    try {
      const streamed = await testThread().runStreamed("describe", {
        outputSchema: { type: "object" },
      });
      for await (const _event of streamed.events) {
        // Consume all events so cleanup runs.
      }
      expect(await readdir(root)).toEqual([]);
    } finally {
      tmpdirSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
