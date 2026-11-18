import * as child_process from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "@jest/globals";
import { CodexExec } from "../src/exec";

jest.mock("node:child_process", () => {
  const actual = jest.requireActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, spawn: jest.fn() };
});

const spawnMock = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

class TestChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

async function consume(): Promise<void> {
  const exec = new CodexExec("codex");
  for await (const _line of exec.run({ input: "prompt" })) {
    // Consume output until the synthetic process exits.
  }
}

describe("CodexExec stderr retention", () => {
  it("keeps only the newest 1 MiB when stderr exceeds the limit", async () => {
    const child = new TestChild();
    spawnMock.mockReturnValue(child as unknown as child_process.ChildProcess);
    const result = consume();

    setImmediate(() => {
      child.stderr.write(Buffer.alloc(3 * 1024 * 1024, "x"));
      child.stderr.write("\nlatest actionable error\n");
      child.emit("exit", 2, null);
      child.stdout.end();
      child.stderr.end();
    });

    let error: Error | undefined;
    try {
      await result;
    } catch (caught) {
      error = caught as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain("earlier stderr output truncated");
    expect(error!.message).toContain("latest actionable error");
    expect(Buffer.byteLength(error!.message, "utf8")).toBeLessThan(1024 * 1024 + 150);
  });

  it("preserves short failures without a truncation marker", async () => {
    const child = new TestChild();
    spawnMock.mockReturnValue(child as unknown as child_process.ChildProcess);
    const result = consume();

    setImmediate(() => {
      child.stderr.write("configuration invalid");
      child.emit("exit", 1, null);
      child.stdout.end();
      child.stderr.end();
    });

    await expect(result).rejects.toThrow("Codex Exec exited with code 1: configuration invalid");
  });

  it("drains a verbose successful process without treating stderr as a failure", async () => {
    const child = new TestChild();
    spawnMock.mockReturnValue(child as unknown as child_process.ChildProcess);
    const result = consume();

    setImmediate(() => {
      for (let i = 0; i < 64; i++) {
        child.stderr.write(Buffer.alloc(64 * 1024, "x"));
      }
      child.emit("exit", 0, null);
      child.stdout.end();
      child.stderr.end();
    });

    await expect(result).resolves.toBeUndefined();
  });
});
