import { describe, expect, it, vi } from "vitest";

import { invokeResponsesStream, invokeToolStream, type StreamEvent } from "../src/api-client";

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

  it("parses generated image SSE events", async () => {
    const chunks = [
      "event: image_generated\r\ndata: {\"filename\":\"cover\",\"mime_type\":\"image/png\",\"base64\":\"aGVsbG8=\"}\r\n\r\n",
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

    expect(events).toEqual([
      {
        type: "image_generated",
        filename: "cover",
        mimeType: "image/png",
        base64: "aGVsbG8="
      },
      { type: "done" }
    ]);
  });

  it("fills missing tail from done.answer payload", async () => {
    const chunks = [
      "event: answer_delta\r\ndata: {\"text\":\"The B\"}\r\n\r\n",
      "event: done\r\ndata: {\"ok\":true,\"answer\":\"The Byzantine Generals Problem\"}\r\n\r\n"
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

    expect(events[0]).toEqual({ type: "answer_delta", text: "The B" });
    expect(events[1]).toEqual({ type: "answer_delta", text: "yzantine Generals Problem" });
    expect(events[2]).toEqual({ type: "done", answer: "The Byzantine Generals Problem" });
  });

  it("does not duplicate when done.answer only differs by surrounding whitespace", async () => {
    const chunks = [
      "event: answer_delta\r\ndata: {\"text\":\"\\n\\n## Title\\nBody\"}\r\n\r\n",
      "event: done\r\ndata: {\"ok\":true,\"answer\":\"## Title\\nBody\"}\r\n\r\n"
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

    expect(events).toEqual([
      { type: "answer_delta", text: "\n\n## Title\nBody" },
      { type: "done", answer: "## Title\nBody" }
    ]);
  });

  it("parses multi-line data blocks with the shared SSE reader", async () => {
    const chunks = [
      "event: answer_delta\r\n",
      "data: {\"text\":\"hel\"}\r\n",
      "data: {\"text\":\"lo\"}\r\n\r\n",
      "event: done\r\n",
      "data: {\"ok\":true}\r\n\r\n"
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

    expect(events).toEqual([
      { type: "answer_delta", text: "hello" },
      { type: "done" }
    ]);
  });
});

describe("invokeResponsesStream", () => {
  it("maps OpenAI Responses SSE events into plugin stream events", async () => {
    const chunks = [
      "event: response.created\r\ndata: {\"type\":\"response.created\",\"response\":{\"metadata\":{\"session_id\":\"sess_r1\"}}}\r\n\r\n",
      "event: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hel\"}\r\n\r\n",
      "event: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"lo\"}\r\n\r\n",
      "event: response.completed\r\ndata: {\"type\":\"response.completed\",\"response\":{\"metadata\":{\"session_id\":\"sess_r1\"}}}\r\n\r\n"
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
    await invokeResponsesStream("http://127.0.0.1:8787", { hello: "world" }, (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({ type: "session", sessionId: "sess_r1" });
    expect(events[1]).toEqual({ type: "answer_delta", text: "hel" });
    expect(events[2]).toEqual({ type: "answer_delta", text: "lo" });
    expect(events[3]).toEqual({ type: "session", sessionId: "sess_r1" });
    expect(events[4]).toEqual({ type: "done" });
  });

  it("maps image_generated events from the Responses endpoint too", async () => {
    const chunks = [
      "event: image_generated\r\ndata: {\"filename\":\"cover\",\"mime_type\":\"image/png\",\"base64\":\"aGVsbG8=\"}\r\n\r\n",
      "event: response.completed\r\ndata: {\"type\":\"response.completed\",\"response\":{\"metadata\":{\"session_id\":\"sess_r1\"}}}\r\n\r\n"
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
    await invokeResponsesStream("http://127.0.0.1:8787", { hello: "world" }, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      {
        type: "image_generated",
        filename: "cover",
        mimeType: "image/png",
        base64: "aGVsbG8="
      },
      { type: "session", sessionId: "sess_r1" },
      { type: "done" }
    ]);
  });

  it("fills missing tail from response.output_text.done", async () => {
    const chunks = [
      "event: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"The B\"}\r\n\r\n",
      "event: response.output_text.done\r\ndata: {\"type\":\"response.output_text.done\",\"text\":\"The Byzantine Generals Problem\"}\r\n\r\n",
      "event: response.completed\r\ndata: {\"type\":\"response.completed\",\"response\":{\"metadata\":{\"session_id\":\"sess_r2\"}}}\r\n\r\n"
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
    await invokeResponsesStream("http://127.0.0.1:8787", { hello: "world" }, (event) => {
      events.push(event);
    });

    expect(events[0]).toEqual({ type: "answer_delta", text: "The B" });
    expect(events[1]).toEqual({ type: "answer_delta", text: "yzantine Generals Problem" });
    expect(events[2]).toEqual({ type: "session", sessionId: "sess_r2" });
    expect(events[3]).toEqual({ type: "done" });
  });

  it("does not duplicate when response.output_text.done only differs by surrounding whitespace", async () => {
    const chunks = [
      "event: response.output_text.delta\r\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"\\nResult\"}\r\n\r\n",
      "event: response.output_text.done\r\ndata: {\"type\":\"response.output_text.done\",\"text\":\"Result\"}\r\n\r\n",
      "event: response.completed\r\ndata: {\"type\":\"response.completed\",\"response\":{\"metadata\":{\"session_id\":\"sess_r3\"}}}\r\n\r\n"
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
    await invokeResponsesStream("http://127.0.0.1:8787", { hello: "world" }, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { type: "answer_delta", text: "\nResult" },
      { type: "session", sessionId: "sess_r3" },
      { type: "done" }
    ]);
  });
});
