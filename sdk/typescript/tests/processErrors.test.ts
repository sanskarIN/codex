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

async function drain(exec: CodexExec): Promise<void> {
  for await (const _line of exec.run({ input: "x".repeat(100000) })) {
    // Consume the stream through process exit.
  }
}

describe("CodexExec subprocess error handling", () => {
  it("returns the CLI diagnostic instead of crashing on early stdin EPIPE", async () => {
    const child = new TestChild();
    spawnMock.mockReturnValue(child as unknown as child_process.ChildProcess);
    const result = drain(new CodexExec("codex"));

    setImmediate(() => {
      child.stdin.emit("error", new Error("write EPIPE"));
      child.stderr.write("invalid configuration");
      child.emit("exit", 2, null);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 2, null);
    });

    await expect(result).rejects.toThrow(/Codex Exec exited with code 2: invalid configuration/);
  });

  it("rejects with a stdin write error when the child otherwise exits cleanly", async () => {
    const child = new TestChild();
    spawnMock.mockReturnValue(child as unknown as child_process.ChildProcess);
    const result = drain(new CodexExec("codex"));

    setImmediate(() => {
      child.stdin.emit("error", new Error("write EOF"));
      child.emit("exit", 0, null);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0, null);
    });

    await expect(result).rejects.toThrow("write EOF");
  });

  it("keeps a child error listener until close after iterator cancellation", async () => {
    const child = new TestChild();
    spawnMock.mockReturnValue(child as unknown as child_process.ChildProcess);
    const iterator = new CodexExec("codex").run({ input: "hello" });

    const first = iterator.next();
    child.stdout.write('{"type":"thread.started","thread_id":"test"}\n');
    expect((await first).value).toContain("thread.started");
    await iterator.return(undefined);

    // The SDK may be done before AbortSignal's child-process error is emitted.
    expect(() => child.emit("error", new Error("AbortError"))).not.toThrow();
    child.emit("exit", null, "SIGTERM");
    child.stdout.end();
    child.stderr.end();
    child.emit("close", null, "SIGTERM");
    expect(child.killed).toBe(true);
  });
});
