# Architecture Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the plugin/server architecture while preserving visible frontend interactions and ensuring streaming writes stay bound to the originating file.

**Architecture:** Split low-level concerns out of large entry files: frontend server lifecycle, SSE parsing, stream rendering, and target-file draft writes; backend session metadata, prompt building, stream parsing, title generation, and FastAPI routes. Keep existing request/response contracts and UI behavior stable.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Vitest, Python 3, FastAPI, pytest, uv, pnpm.

---

## File Structure

- Modify `src/api-client.ts`: add shared SSE parser and keep existing stream APIs.
- Modify `tests/api-client-stream.test.ts`: add parser regression coverage through public stream APIs.
- Modify `src/file-actions.ts`: introduce anchored chat drafts and editor offset based replacement while retaining compatibility wrappers.
- Modify `tests/file-actions.test.ts`: cover anchored draft insertion and replacement.
- Create `src/local-server-manager.ts`: move server health/startup logic out of `main.ts`.
- Create `src/stream-renderer.ts`: move RAF stream rendering state out of `main.ts`.
- Modify `src/main.ts`: wire new managers/renderers and target-file draft updates.
- Create `server/session_metadata_store.py`: persist session titles and title-generation state.
- Create `server/tests/test_session_metadata_store.py`: verify metadata persistence and overwrite behavior.
- Modify `server/prompt_builder.py`: remove in-memory session history from prompts.
- Create `server/tests/test_prompt_builder.py`: verify prompt does not contain `Session history:`.
- Create `server/stream_parser.py`: move `_TaggedStreamParser`.
- Create `server/tests/test_stream_parser.py`: cover chunked tags and flush fallback.
- Create `server/context.py`: define shared backend dependencies.
- Create `server/services/title_generator.py`: move title generation helpers.
- Create `server/routes/chat.py`: move invoke/chat/responses routes.
- Create `server/routes/providers.py`: move provider routes.
- Create `server/routes/sessions.py`: move session list route.
- Modify `server/app.py`: app factory/glue only.
- Modify `server/tests/test_app.py`: keep current route contract tests passing with new module boundaries.

## Task 1: Shared SSE Parser

**Files:**
- Modify: `src/api-client.ts`
- Modify: `tests/api-client-stream.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to `tests/api-client-stream.test.ts` under `describe("invokeToolStream", ...)`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/api-client-stream.test.ts`

Expected: FAIL because the current SSE parser joins multi-line `data:` fragments into invalid JSON or does not merge their text payloads.

- [ ] **Step 3: Implement shared parser**

In `src/api-client.ts`, add:

```ts
async function parseSSEStream(
  response: Response,
  failureMessage: string,
  onMessage: (eventName: string, data: unknown) => void
): Promise<void> {
  if (!response.ok || !response.body) {
    throw new Error(`${failureMessage}: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const takeNextBlock = (): string | null => {
    const match = buffer.match(/\r?\n\r?\n/);
    if (!match || match.index === undefined) {
      return null;
    }
    const block = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    return block;
  };

  const emitBlock = (block: string): void => {
    const lines = block.split(/\r?\n/);
    const eventLine = lines.find((line) => line.startsWith("event:"));
    if (!eventLine) {
      return;
    }

    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    const data = mergeSSEDataLines(dataLines);
    onMessage(eventLine.slice(6).trim(), data);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    let block = takeNextBlock();
    while (block !== null) {
      emitBlock(block);
      block = takeNextBlock();
    }
  }
}
```

Also add:

```ts
function mergeSSEDataLines(lines: string[]): unknown {
  if (lines.length === 0) {
    return {};
  }
  if (lines.length === 1) {
    return JSON.parse(lines[0]);
  }

  const parsed = lines.map((line) => JSON.parse(line));
  if (parsed.every((item) => isRecord(item) && typeof item.text === "string")) {
    return {
      ...parsed[0],
      text: parsed.map((item) => String((item as { text: string }).text)).join("")
    };
  }
  if (parsed.every((item) => isRecord(item) && typeof item.delta === "string")) {
    return {
      ...parsed[0],
      delta: parsed.map((item) => String((item as { delta: string }).delta)).join("")
    };
  }
  return parsed.at(-1) ?? {};
}
```

Refactor `invokeToolStream` and `invokeResponsesStream` to call `parseSSEStream(...)`; keep their event mapping logic unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/api-client-stream.test.ts`

Expected: PASS.

## Task 2: Anchored Draft Updates

**Files:**
- Modify: `src/file-actions.ts`
- Modify: `tests/file-actions.test.ts`
- Modify: `tests/mocks/obsidian.ts`

- [ ] **Step 1: Write failing tests**

Add tests that use a fake editor with `posToOffset`, `offsetToPos`, and `replaceRange`:

```ts
class FakeEditor {
  value: string;

  constructor(value: string) {
    this.value = value;
  }

  getValue() {
    return this.value;
  }

  setValue(value: string) {
    this.value = value;
  }

  lastLine() {
    return this.value.split("\n").length - 1;
  }

  getLine(line: number) {
    return this.value.split("\n")[line] ?? "";
  }

  setCursor() {}

  replaceSelection(text: string) {
    this.value += text;
  }

  posToOffset(position: { line: number; ch: number }) {
    const lines = this.value.split("\n");
    let offset = 0;
    for (let i = 0; i < position.line; i += 1) {
      offset += lines[i].length + 1;
    }
    return offset + position.ch;
  }

  offsetToPos(offset: number) {
    const before = this.value.slice(0, offset);
    const lines = before.split("\n");
    return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
  }

  replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) {
    const start = this.posToOffset(from);
    const end = this.posToOffset(to);
    this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
  }
}
```

Then add:

```ts
describe("anchored chat drafts", () => {
  it("updates only the anchored draft when identical text appears earlier", () => {
    const editor = new FakeEditor("same block\n");
    const anchor = appendUserAndThinkingDraft(editor as never, "note.md", "Explain");
    editor.value = `${anchor.currentBlock}\n\n${editor.value}`;

    const updated = updateThinkingDraft(editor as never, anchor, "reasoning");

    expect(updated.currentBlock).toContain("reasoning");
    expect(editor.value.startsWith(anchor.currentBlock)).toBe(true);
    expect(editor.value.endsWith("same block\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/file-actions.test.ts`

Expected: FAIL because `appendUserAndThinkingDraft` does not accept `filePath` or return an anchor yet.

- [ ] **Step 3: Implement anchors**

In `src/file-actions.ts`, export:

```ts
export interface ChatDraftAnchor {
  filePath: string;
  startOffset: number;
  endOffset: number;
  instruction: string;
  currentBlock: string;
}
```

Change `appendUserAndThinkingDraft(editor, filePath, instruction)` to compute the inserted start/end offsets with `editor.posToOffset(editor.getCursor())` after `moveCursorToEnd`, insert the payload, and return `ChatDraftAnchor`.

Change `updateThinkingDraft`, `updateAnswerDraft`, and `finalizeThinkingDraft` to accept a `ChatDraftAnchor`, use `editor.offsetToPos` and `editor.replaceRange`, and mutate/return the anchor.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/file-actions.test.ts`

Expected: PASS.

## Task 3: Frontend Managers

**Files:**
- Create: `src/local-server-manager.ts`
- Create: `src/stream-renderer.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Extract LocalServerManager**

Move `ensureServerRunning`, `launchAndWaitForServer`, `checkServerHealth`, `resolveServerStartupCwd`, and `sleep` into `LocalServerManager`.

- [ ] **Step 2: Wire main.ts**

Instantiate `this.localServerManager` in `onload` before auto-start and replace `this.ensureServerRunning(...)` calls with `this.localServerManager.ensureServerRunning(...)`.

- [ ] **Step 3: Extract StreamRenderer**

Move `StreamRenderState`, `createStreamRenderState`, `enqueueThinking`, `enqueueAnswer`, `ensureRenderPump`, and `waitForDrainWithTimeout` into `StreamRenderer`.

- [ ] **Step 4: Wire handleSubmit**

Create a renderer with callbacks that update the anchored draft and scroll the target context.

- [ ] **Step 5: Verify**

Run: `pnpm test`

Expected: PASS.

## Task 4: Backend Metadata and Prompt Cleanup

**Files:**
- Create: `server/session_metadata_store.py`
- Create: `server/tests/test_session_metadata_store.py`
- Create: `server/tests/test_prompt_builder.py`
- Modify: `server/prompt_builder.py`
- Modify: `server/app.py`

- [ ] **Step 1: Write metadata store tests**

Create tests for saving, loading, updating, and empty fallback.

- [ ] **Step 2: Write prompt tests**

Create tests asserting prompts omit `Session history:` even when `SessionRecord.history` has turns.

- [ ] **Step 3: Run tests to verify failure**

Run: `uv run pytest server/tests/test_session_metadata_store.py server/tests/test_prompt_builder.py -q`

Expected: FAIL because store does not exist and prompt still renders history.

- [ ] **Step 4: Implement store and prompt cleanup**

Add JSON metadata store and remove history block construction from prompt builder.

- [ ] **Step 5: Wire session listing**

Use metadata titles in `/api/v1/sessions`; keep in-memory title compatibility during transition if needed.

- [ ] **Step 6: Verify**

Run: `uv run pytest server/tests/test_session_metadata_store.py server/tests/test_prompt_builder.py server/tests/test_app.py -q`

Expected: PASS.

## Task 5: Backend Route Split and Stream Parser

**Files:**
- Create: `server/context.py`
- Create: `server/stream_parser.py`
- Create: `server/tests/test_stream_parser.py`
- Create: `server/services/__init__.py`
- Create: `server/services/title_generator.py`
- Create: `server/routes/__init__.py`
- Create: `server/routes/chat.py`
- Create: `server/routes/providers.py`
- Create: `server/routes/sessions.py`
- Modify: `server/app.py`

- [ ] **Step 1: Write stream parser tests**

Test chunked tags, plain text, uppercase tags, and missing close tag flush behavior.

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest server/tests/test_stream_parser.py -q`

Expected: FAIL because `server.stream_parser` does not exist.

- [ ] **Step 3: Move parser**

Move `_TaggedStreamParser` to `server/stream_parser.py`, preserving behavior and making tag matching case-insensitive where tests require it.

- [ ] **Step 4: Split routes**

Move route handlers into route modules and register them from `server/app.py`.

- [ ] **Step 5: Verify route contracts**

Run: `uv run pytest server/tests/test_app.py server/tests/test_stream_parser.py -q`

Expected: PASS.

## Task 6: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run frontend tests**

Run: `pnpm test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run backend tests**

Run: `uv run pytest server/tests -q`

Expected: all pytest tests pass.

- [ ] **Step 3: Run build**

Run: `pnpm run build`

Expected: build succeeds and updates `main.js` if the build emits it.

- [ ] **Step 4: Review status**

Run: `git status --short`

Expected: only planned source, test, docs, and generated build files are changed.

