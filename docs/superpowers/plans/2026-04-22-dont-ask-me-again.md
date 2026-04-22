# dont-ask-me-again Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal Obsidian plugin that sends the active note context and optional selection to a session-aware tool server, creates a new note from the structured response, opens it in the current tab, and inserts a wikilink back into the source note.

**Architecture:** Keep the repository flat at the root while still separating responsibilities into a few focused TypeScript files. The plugin owns UI state, session state, and note mutation; the server owns AI execution and must return strict structured tool results.

**Tech Stack:** Obsidian plugin API, TypeScript, esbuild, Vitest, Zod

---

## File Map

- Create: `manifest.json`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `vitest.config.ts`
- Create: `main.ts`
- Create: `styles.css`
- Create: `settings.ts`
- Create: `session-manager.ts`
- Create: `selection-context.ts`
- Create: `api-client.ts`
- Create: `file-actions.ts`
- Create: `floating-ui.ts`
- Create: `tests/api-client.test.ts`
- Create: `tests/file-actions.test.ts`
- Create: `tests/session-manager.test.ts`
- Create: `tests/selection-context.test.ts`

### Task 1: Scaffold the plugin package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `vitest.config.ts`
- Create: `manifest.json`

- [ ] **Step 1: Write the package manifest**

```json
{
  "name": "dont-ask-me-again",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "dev": "node esbuild.config.mjs --watch",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "esbuild": "^0.25.0",
    "obsidian": "^1.8.10",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4",
    "zod": "^3.24.3"
  }
}
```

- [ ] **Step 2: Add TypeScript compiler settings**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["DOM", "ES2022"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Add the build script**

```js
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian"]
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
```

- [ ] **Step 4: Add test runner config**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 5: Add the Obsidian manifest**

```json
{
  "id": "dont-ask-me-again",
  "name": "dont-ask-me-again",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Create AI answer notes from the active Obsidian note with session-aware tool calls.",
  "author": "Codex",
  "isDesktopOnly": false
}
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`

Expected: `added ... packages` with no install errors

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json esbuild.config.mjs vitest.config.ts manifest.json package-lock.json
git commit -m "chore: scaffold obsidian plugin package"
```

### Task 2: Define settings and session state

**Files:**
- Create: `settings.ts`
- Create: `session-manager.ts`
- Test: `tests/session-manager.test.ts`

- [ ] **Step 1: Write the failing session tests**

```ts
import { describe, expect, it } from "vitest";
import { SessionManager } from "../session-manager";

describe("SessionManager", () => {
  it("starts without an active session", () => {
    const manager = new SessionManager();
    expect(manager.getActiveSessionId()).toBeNull();
  });

  it("stores a new session id", () => {
    const manager = new SessionManager();
    manager.setActiveSessionId("session-123");
    expect(manager.getActiveSessionId()).toBe("session-123");
  });

  it("clears the active session", () => {
    const manager = new SessionManager();
    manager.setActiveSessionId("session-123");
    manager.clearActiveSessionId();
    expect(manager.getActiveSessionId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the session tests to verify failure**

Run: `npm test -- tests/session-manager.test.ts`

Expected: FAIL with module-not-found errors for `session-manager.ts`

- [ ] **Step 3: Write settings defaults and session manager**

```ts
export interface DontAskMeAgainSettings {
  serverBaseUrl: string;
  defaultTemplates: string[];
  selectionUiMode: "templates-first" | "input-first";
  showStatusBar: boolean;
  floatingBoxDefaultPosition: "bottom-docked";
  openResultInCurrentTab: boolean;
}

export const DEFAULT_SETTINGS: DontAskMeAgainSettings = {
  serverBaseUrl: "http://127.0.0.1:8787",
  defaultTemplates: [
    "Explain this in detail.",
    "Give me a concrete example.",
    "Explain this like I am five."
  ],
  selectionUiMode: "templates-first",
  showStatusBar: true,
  floatingBoxDefaultPosition: "bottom-docked",
  openResultInCurrentTab: true
};
```

```ts
export class SessionManager {
  private activeSessionId: string | null = null;

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  setActiveSessionId(sessionId: string): void {
    this.activeSessionId = sessionId;
  }

  clearActiveSessionId(): void {
    this.activeSessionId = null;
  }
}
```

- [ ] **Step 4: Run the session tests to verify success**

Run: `npm test -- tests/session-manager.test.ts`

Expected: PASS with 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add settings.ts session-manager.ts tests/session-manager.test.ts
git commit -m "feat: add settings defaults and session state"
```

### Task 3: Define the API client and response validation

**Files:**
- Create: `api-client.ts`
- Test: `tests/api-client.test.ts`

- [ ] **Step 1: Write the failing API client tests**

```ts
import { describe, expect, it } from "vitest";
import { parseToolResponse } from "../api-client";

describe("parseToolResponse", () => {
  it("accepts a valid tool response", () => {
    const parsed = parseToolResponse({
      request_id: "req-1",
      ok: true,
      result: {
        session_id: "session-1",
        filename: "answer-note",
        markdown: "# Answer"
      },
      error: null
    });

    expect(parsed.result.filename).toBe("answer-note");
  });

  it("rejects a success response with no filename", () => {
    expect(() =>
      parseToolResponse({
        request_id: "req-1",
        ok: true,
        result: {
          session_id: "session-1",
          markdown: "# Answer"
        },
        error: null
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the API client tests to verify failure**

Run: `npm test -- tests/api-client.test.ts`

Expected: FAIL with module-not-found errors for `api-client.ts`

- [ ] **Step 3: Write the request and response schemas**

```ts
import { z } from "zod";

export const toolRequestSchema = z.object({
  request_id: z.string(),
  tool_name: z.literal("obsidian_answer"),
  session_id: z.string().nullable().optional(),
  arguments: z.object({
    active_file_path: z.string(),
    active_file_content: z.string(),
    selection_text: z.string(),
    instruction: z.string()
  })
});

const toolSuccessSchema = z.object({
  request_id: z.string(),
  ok: z.literal(true),
  result: z.object({
    session_id: z.string(),
    filename: z.string().min(1),
    markdown: z.string()
  }),
  error: z.null()
});

const toolErrorSchema = z.object({
  request_id: z.string(),
  ok: z.literal(false),
  result: z.null(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean()
  })
});

export const toolResponseSchema = z.union([toolSuccessSchema, toolErrorSchema]);

export function parseToolResponse(payload: unknown) {
  return toolResponseSchema.parse(payload);
}
```

- [ ] **Step 4: Add transport helpers**

```ts
export interface ToolCallArguments {
  activeFilePath: string;
  activeFileContent: string;
  selectionText: string;
  instruction: string;
}

export function buildToolRequest(
  requestId: string,
  sessionId: string | null,
  args: ToolCallArguments
) {
  return toolRequestSchema.parse({
    request_id: requestId,
    tool_name: "obsidian_answer",
    session_id: sessionId,
    arguments: {
      active_file_path: args.activeFilePath,
      active_file_content: args.activeFileContent,
      selection_text: args.selectionText,
      instruction: args.instruction
    }
  });
}
```

- [ ] **Step 5: Run the API client tests to verify success**

Run: `npm test -- tests/api-client.test.ts`

Expected: PASS with 2 passing tests

- [ ] **Step 6: Commit**

```bash
git add api-client.ts tests/api-client.test.ts
git commit -m "feat: add strict tool response validation"
```

### Task 4: Capture and preserve selection context

**Files:**
- Create: `selection-context.ts`
- Test: `tests/selection-context.test.ts`

- [ ] **Step 1: Write the failing selection tests**

```ts
import { describe, expect, it } from "vitest";
import { buildSelectionAlias } from "../selection-context";

describe("buildSelectionAlias", () => {
  it("uses the selected text as the wikilink alias", () => {
    expect(buildSelectionAlias("What is entropy?")).toBe("What is entropy?");
  });

  it("trims surrounding whitespace", () => {
    expect(buildSelectionAlias("  entropy  ")).toBe("entropy");
  });
});
```

- [ ] **Step 2: Run the selection tests to verify failure**

Run: `npm test -- tests/selection-context.test.ts`

Expected: FAIL with module-not-found errors for `selection-context.ts`

- [ ] **Step 3: Write the selection helpers**

```ts
export interface CachedSelection {
  text: string;
  from: { line: number; ch: number } | null;
  to: { line: number; ch: number } | null;
}

export function buildSelectionAlias(selectionText: string): string {
  return selectionText.trim();
}

export function hasSelection(selection: CachedSelection): boolean {
  return buildSelectionAlias(selection.text).length > 0;
}
```

- [ ] **Step 4: Run the selection tests to verify success**

Run: `npm test -- tests/selection-context.test.ts`

Expected: PASS with 2 passing tests

- [ ] **Step 5: Commit**

```bash
git add selection-context.ts tests/selection-context.test.ts
git commit -m "feat: add selection context helpers"
```

### Task 5: Implement filename handling and source-note mutations

**Files:**
- Create: `file-actions.ts`
- Test: `tests/file-actions.test.ts`

- [ ] **Step 1: Write the failing file action tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildResolvedMarkdownPath,
  buildSourceReplacement
} from "../file-actions";

describe("buildResolvedMarkdownPath", () => {
  it("adds the markdown extension when needed", () => {
    expect(buildResolvedMarkdownPath("answer-note")).toBe("answer-note.md");
  });
});

describe("buildSourceReplacement", () => {
  it("builds an aliased wikilink for selected text", () => {
    expect(buildSourceReplacement("answer-note", "Entropy")).toBe("[[answer-note|Entropy]]");
  });

  it("builds a plain wikilink when no selection exists", () => {
    expect(buildSourceReplacement("answer-note", "")).toBe("[[answer-note]]");
  });
});
```

- [ ] **Step 2: Run the file action tests to verify failure**

Run: `npm test -- tests/file-actions.test.ts`

Expected: FAIL with module-not-found errors for `file-actions.ts`

- [ ] **Step 3: Write the filename and replacement helpers**

```ts
function sanitizeFileStem(filename: string): string {
  return filename.replace(/[\\\\/:*?\"<>|]/g, "-").trim();
}

export function buildResolvedMarkdownPath(filename: string): string {
  const stem = sanitizeFileStem(filename).replace(/\\.md$/i, "");
  return `${stem}.md`;
}

export function buildSourceReplacement(filename: string, selectionText: string): string {
  const stem = buildResolvedMarkdownPath(filename).replace(/\\.md$/i, "");
  const alias = selectionText.trim();

  return alias.length > 0 ? `[[${stem}|${alias}]]` : `[[${stem}]]`;
}
```

- [ ] **Step 4: Run the file action tests to verify success**

Run: `npm test -- tests/file-actions.test.ts`

Expected: PASS with 3 passing tests

- [ ] **Step 5: Commit**

```bash
git add file-actions.ts tests/file-actions.test.ts
git commit -m "feat: add filename and wikilink helpers"
```

### Task 6: Build the floating UI and plugin bootstrap

**Files:**
- Create: `floating-ui.ts`
- Create: `styles.css`
- Create: `main.ts`

- [ ] **Step 1: Write the floating UI contract first**

```ts
export interface FloatingSubmitPayload {
  instruction: string;
}

export interface FloatingBoxOptions {
  templates: string[];
  mode: "templates-first" | "input-first";
  onSubmit: (payload: FloatingSubmitPayload) => Promise<void>;
}
```

- [ ] **Step 2: Implement the floating box DOM wrapper**

```ts
import { Plugin } from "obsidian";

export class FloatingBox {
  constructor(private readonly plugin: Plugin, private readonly options: FloatingBoxOptions) {}

  mount(): void {
    // create root container, input, template buttons, and submit button
  }

  destroy(): void {
    // remove root container
  }
}
```

- [ ] **Step 3: Implement plugin bootstrap**

```ts
import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type DontAskMeAgainSettings } from "./settings";
import { SessionManager } from "./session-manager";

export default class DontAskMeAgainPlugin extends Plugin {
  settings!: DontAskMeAgainSettings;
  sessionManager = new SessionManager();

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addCommand({ id: "toggle-floating-box", name: "Toggle Floating Box", callback: () => {} });
    this.addCommand({ id: "new-session", name: "New Session", callback: () => {} });
    this.addCommand({ id: "exit-session", name: "Exit Session", callback: () => {} });
  }
}
```

- [ ] **Step 4: Build the status bar session controls**

```ts
const status = this.addStatusBarItem();
status.setText(this.sessionManager.getActiveSessionId() ?? "No Session");
status.addEventListener("click", () => {
  // open minimal session actions menu
});
```

- [ ] **Step 5: Run the build**

Run: `npm run build`

Expected: `main.js` generated with no TypeScript or bundling errors

- [ ] **Step 6: Commit**

```bash
git add main.ts floating-ui.ts styles.css main.js
git commit -m "feat: add plugin bootstrap and floating ui shell"
```

### Task 7: Wire tool invocation to note creation

**Files:**
- Modify: `main.ts`
- Modify: `api-client.ts`
- Modify: `file-actions.ts`

- [ ] **Step 1: Implement the submit pipeline**

```ts
// Inside the submit handler:
// 1. collect active file and selection
// 2. build request payload
// 3. POST to `${serverBaseUrl}/tools/invoke`
// 4. parse strict response
// 5. update session manager
// 6. create target note
// 7. open target note in current tab
// 8. mutate source note with wikilink
```

- [ ] **Step 2: Add the minimal transport call**

```ts
export async function invokeTool(baseUrl: string, payload: unknown) {
  const response = await fetch(`${baseUrl}/tools/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return parseToolResponse(await response.json());
}
```

- [ ] **Step 3: Add note creation helpers**

```ts
// Add helpers that call app.vault.create, app.vault.getAvailablePath, and app.workspace.getLeaf(false)
// Keep source-note edits after successful note creation only
```

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected: PASS for all test files

- [ ] **Step 5: Run the build again**

Run: `npm run build`

Expected: `main.js` generated with no errors

- [ ] **Step 6: Commit**

```bash
git add main.ts api-client.ts file-actions.ts tests
git commit -m "feat: wire tool invocation to note creation flow"
```

## Self-Review

- Spec coverage:
  - session lifecycle is covered by Task 2 and Task 6
  - strict tool contract is covered by Task 3 and Task 7
  - selection-preserving source-note behavior is covered by Task 4, Task 5, and Task 7
  - floating box and status bar behavior is covered by Task 6
- Placeholder scan:
  - the only non-literal code references are Obsidian API calls called out explicitly in Task 7 Step 3; implementation should expand these exact calls during execution
- Type consistency:
  - `session_id`, `filename`, `markdown`, `selectionText`, and `instruction` are named consistently across tasks
