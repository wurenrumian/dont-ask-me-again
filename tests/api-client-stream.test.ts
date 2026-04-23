import { describe, expect, it, vi } from "vitest";

import { invokeToolStream, type StreamEvent } from "../src/api-client";

describe("invokeToolStream", () => {
  it("parses CRLF-separated SSE blocks", async () => {
    const chunks = [
      "event: session\r\ndata: {\"session_id\":\"sess_1\"}\r\n\r\n",
      "event: thinking_delta\r\ndata: {\"text\":\"rea\"}\r\n\r\n",
      "event: thinking_delta\r\ndata: {\"text\":\"son\"}\r\n\r\n",
      "event: answer_delta\r\ndata: {\"text\":\"ok\"}\r\n\r\n",
      "event: done\r\ndata: {\"ok\":true}\r\n\r\n"
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: stream
      })
    );

    const events: StreamEvent[] = [];
    await invokeToolStream("http://127.0.0.1:8787", { hello: "world" }, (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({ type: "session", sessionId: "sess_1" });
    expect(events[1]).toEqual({ type: "thinking_delta", text: "rea" });
    expect(events[2]).toEqual({ type: "thinking_delta", text: "son" });
    expect(events[3]).toEqual({ type: "answer_delta", text: "ok" });
    expect(events[4]).toEqual({ type: "done" });
  });
});
