import { describe, expect, it, vi } from "vitest";

import { StreamRenderer } from "../src/stream-renderer";

function installAnimationFrameMock() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();

  const requestAnimationFrame = (callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  };
  const cancelAnimationFrame = (id: number) => {
    callbacks.delete(id);
  };

  vi.stubGlobal("window", {
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout,
    clearTimeout
  });

  return {
    flushNext() {
      const next = callbacks.entries().next();
      if (next.done) {
        return false;
      }
      const [id, callback] = next.value;
      callbacks.delete(id);
      callback(performance.now());
      return true;
    },
    pendingCount() {
      return callbacks.size;
    }
  };
}

describe("StreamRenderer", () => {
  it("does not animate fallback thinking while waiting for the first real stream delta", () => {
    vi.useFakeTimers();
    const raf = installAnimationFrameMock();
    const updateThinking = vi.fn();

    const renderer = new StreamRenderer({
      updateThinking,
      updateAnswer: vi.fn(),
      onChanged: vi.fn()
    });

    renderer.finish();
    raf.flushNext();
    vi.advanceTimersByTime(500);

    expect(updateThinking).not.toHaveBeenCalled();
    expect(raf.pendingCount()).toBe(0);
  });

  it("coalesces queued answer text into a single editor update per render tick", () => {
    vi.useFakeTimers();
    const raf = installAnimationFrameMock();
    const updateAnswer = vi.fn();
    const onChanged = vi.fn();
    const renderer = new StreamRenderer({
      updateThinking: vi.fn(),
      updateAnswer,
      onChanged
    });
    const answer = "x".repeat(2000);

    renderer.pushAnswer(answer);
    raf.flushNext();

    expect(updateAnswer).toHaveBeenCalledTimes(1);
    expect(updateAnswer).toHaveBeenLastCalledWith(answer);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(raf.pendingCount()).toBe(0);
  });

  it("throttles follow-up answer updates so editor replacements are not frame-bound", () => {
    vi.useFakeTimers();
    const raf = installAnimationFrameMock();
    const updateAnswer = vi.fn();
    const renderer = new StreamRenderer({
      updateThinking: vi.fn(),
      updateAnswer,
      onChanged: vi.fn()
    });

    renderer.pushAnswer("a");
    raf.flushNext();
    renderer.pushAnswer("b");
    expect(raf.pendingCount()).toBe(0);

    vi.advanceTimersByTime(79);
    expect(updateAnswer).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(raf.flushNext()).toBe(true);
    expect(updateAnswer).toHaveBeenCalledTimes(2);
    expect(updateAnswer).toHaveBeenLastCalledWith("ab");
  });
});
