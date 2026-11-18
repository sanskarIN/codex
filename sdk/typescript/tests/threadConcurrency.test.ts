import { describe, expect, it } from "@jest/globals";

import type { CodexExec } from "../src/exec";
import { Thread } from "../src/thread";

function createControlledExec() {
  let calls = 0;
  let notifyFirstStarted!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    notifyFirstStarted = resolve;
  });
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const exec = {
    async *run(): AsyncGenerator<string> {
      const call = ++calls;
      yield JSON.stringify({ type: "thread.started", thread_id: `thread-${call}` });
      if (call === 1) {
        notifyFirstStarted();
        await firstCanFinish;
      }
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

  return {
    exec,
    firstStarted,
    finishFirst: () => releaseFirst(),
    calls: () => calls,
  };
}

describe("Thread turn concurrency", () => {
  it("rejects concurrent run calls without starting a second execution", async () => {
    const controlled = createControlledExec();
    const thread = new Thread(controlled.exec, {}, {});
    const first = thread.run("first");
    await controlled.firstStarted;

    try {
      await expect(thread.run("overlap")).rejects.toThrow(
        "A turn is already running on this thread",
      );
      expect(controlled.calls()).toBe(1);
      expect(thread.id).toBe("thread-1");
    } finally {
      controlled.finishFirst();
    }

    await expect(first).resolves.toMatchObject({ items: [], finalResponse: "" });
    await expect(thread.run("after completion")).resolves.toMatchObject({
      items: [],
      finalResponse: "",
    });
    expect(controlled.calls()).toBe(2);
  });

  it("rejects overlapping streamed and non-streamed turns", async () => {
    const controlled = createControlledExec();
    const thread = new Thread(controlled.exec, {}, {});
    const first = await thread.runStreamed("first");
    expect((await first.events.next()).value).toEqual({
      type: "thread.started",
      thread_id: "thread-1",
    });

    try {
      const overlapping = await thread.runStreamed("overlap");
      await expect(overlapping.events.next()).rejects.toThrow(
        "A turn is already running on this thread",
      );
      await expect(thread.run("overlap")).rejects.toThrow(
        "A turn is already running on this thread",
      );
      expect(controlled.calls()).toBe(1);
    } finally {
      controlled.finishFirst();
    }

    for await (const event of first.events) {
      expect(event.type).toBe("turn.completed");
    }
    await expect(thread.run("after completion")).resolves.toBeDefined();
    expect(controlled.calls()).toBe(2);
  });

  it("releases the guard after the executor fails", async () => {
    let calls = 0;
    const exec = {
      async *run(): AsyncGenerator<string> {
        calls += 1;
        if (calls === 1) {
          throw new Error("synthetic execution failure");
        }
        yield JSON.stringify({ type: "thread.started", thread_id: "recovered-thread" });
        yield JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
          },
        });
      },
    } as unknown as CodexExec;
    const thread = new Thread(exec, {}, {});

    await expect(thread.run("fails")).rejects.toThrow("synthetic execution failure");
    await expect(thread.run("recovers")).resolves.toMatchObject({ items: [] });
    expect(calls).toBe(2);
  });

  it("releases the guard when a streamed event iterator closes early", async () => {
    const controlled = createControlledExec();
    const thread = new Thread(controlled.exec, {}, {});
    const streaming = await thread.runStreamed("first");
    await streaming.events.next();
    await streaming.events.return(undefined);

    await expect(thread.run("after cancellation")).resolves.toBeDefined();
    expect(controlled.calls()).toBe(2);
  });

  it("releases the guard after a setup error", async () => {
    const controlled = createControlledExec();
    const thread = new Thread(controlled.exec, {}, {});

    await expect(thread.run("invalid schema", { outputSchema: null })).rejects.toThrow(
      "outputSchema must be a plain JSON object",
    );

    const valid = thread.run("valid");
    await controlled.firstStarted;
    controlled.finishFirst();
    await expect(valid).resolves.toBeDefined();
    expect(controlled.calls()).toBe(1);
  });
});
