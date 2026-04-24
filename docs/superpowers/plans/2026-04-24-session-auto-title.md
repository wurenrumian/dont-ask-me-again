# Session Auto Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend-owned automatic session title generation from the first request, plus a frontend setting to pick the title model or disable the feature.

**Architecture:** Extend the in-memory session record with title metadata, trigger one background title-generation attempt when a new session receives its first user request, and expose the title through the existing session list contract. On the frontend, persist a single `titleGenerationModelId` setting, surface it in settings as a dropdown built from existing model-provider entries, and render session titles when present while keeping all session identity logic based on `session_id`.

**Tech Stack:** FastAPI, Pydantic, Python pytest, Obsidian plugin TypeScript, Vitest, pnpm

---

### Task 1: Add failing backend contract tests for session titles

**Files:**
- Modify: `server/tests/test_app.py`
- Modify: `server/schemas.py`
- Modify: `server/session_store.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_list_sessions_includes_nullable_title(monkeypatch, tmp_path) -> None:
    workspace = tmp_path / "nanobot-workspace"
    sessions = workspace / "sessions"
    sessions.mkdir(parents=True)

    session_file = sessions / "dont-ask-me-again_sess_with_title.jsonl"
    session_file.write_text("x", encoding="utf-8")

    monkeypatch.setattr(app_module.settings, "nanobot_workspace", str(workspace))
    monkeypatch.setattr(app_module.settings, "nanobot_session_prefix", "dont-ask-me-again")
    monkeypatch.setattr(
        app_module.session_store,
        "seed_title",
        lambda session_id, title: None,
        raising=False,
    )

    app_module.session_store.get_or_create("sess_with_title")
    app_module.session_store.set_title("sess_with_title", "First turn summary")

    response = client.get("/api/v1/sessions?limit=10")

    assert response.status_code == 200
    body = response.json()
    assert body["entries"][0]["session_id"] == "sess_with_title"
    assert body["entries"][0]["title"] == "First turn summary"


def test_new_session_first_request_starts_title_generation_once(monkeypatch) -> None:
    scheduled: list[tuple[str, str]] = []

    async def fake_run_turn(prompt: str, session_id: str) -> str:
        return "ok"

    def fake_schedule(session, first_user_text: str) -> None:
        scheduled.append((session.session_id, first_user_text))

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)
    monkeypatch.setattr(app_module, "_schedule_session_title_generation", fake_schedule)

    response = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-1",
            "session_id": None,
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "Draft a changelog summary"
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"}
        }
    )

    assert response.status_code == 200
    assert scheduled == [
        (response.json()["result"]["session_id"], "Draft a changelog summary")
    ]


def test_existing_session_does_not_retry_title_generation(monkeypatch) -> None:
    seen_calls: list[str] = []
    session = app_module.session_store.create()

    async def fake_run_turn(prompt: str, session_id: str) -> str:
        return "ok"

    def fake_schedule(session_record, first_user_text: str) -> None:
        seen_calls.append(session_record.session_id)

    monkeypatch.setattr(app_module.runtime, "run_turn", fake_run_turn)
    monkeypatch.setattr(app_module, "_schedule_session_title_generation", fake_schedule)

    first = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-1",
            "session_id": session.session_id,
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "first"
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"}
        }
    )
    second = client.post(
        "/api/v1/invoke",
        json={
            "request_id": "req-2",
            "session_id": first.json()["result"]["session_id"],
            "input": {
                "active_file_path": "note.md",
                "active_file_content": "# Note",
                "selection_text": "",
                "instruction": "second"
            },
            "client": {"name": "dont-ask-me-again", "version": "0.1.0"}
        }
    )

    assert second.status_code == 200
    assert seen_calls == []
```

- [ ] **Step 2: Run backend tests to verify they fail**

Run: `uv run pytest server/tests/test_app.py -k "title or sessions" -q`

Expected: FAIL because `SessionEntry` does not include `title`, `InMemorySessionStore` does not expose title APIs, and the app does not schedule title generation.

- [ ] **Step 3: Add minimal schema and store scaffolding**

```python
class SessionEntry(BaseModel):
    session_id: str
    title: str | None = None
    updated_at: str | None = None
```

```python
@dataclass
class SessionRecord:
    session_id: str
    created_at: datetime
    updated_at: datetime
    history: list[dict[str, str]] = field(default_factory=list)
    title: str | None = None
    title_generation_state: str = "pending"
```

```python
class InMemorySessionStore:
    def set_title(self, session_id: str, title: str | None) -> None:
        record = self._records[session_id]
        record.title = title
        record.updated_at = datetime.now(UTC)
```

- [ ] **Step 4: Re-run backend tests to verify they still fail for the right reason**

Run: `uv run pytest server/tests/test_app.py -k "title or sessions" -q`

Expected: FAIL now only because the app path still does not schedule title generation or return titles from the session list route.

- [ ] **Step 5: Commit**

```bash
git add server/tests/test_app.py server/schemas.py server/session_store.py
git commit -m "test: add backend coverage for session titles"
```

### Task 2: Implement backend session title generation and session-list plumbing

**Files:**
- Modify: `server/app.py`
- Modify: `server/session_store.py`
- Modify: `server/session_catalog.py`
- Modify: `server/provider_config_store.py`
- Modify: `server/schemas.py`

- [ ] **Step 1: Write one more failing test for normalization and disabled behavior**

```python
def test_generate_title_normalizes_and_stores_result(monkeypatch) -> None:
    session = app_module.session_store.create()
    app_module.session_store.append_turn(session.session_id, "user", "Explain provider sync")

    monkeypatch.setattr(
        app_module,
        "_resolve_title_generation_model",
        lambda: {"id": "m1", "provider": "openai", "model": "gpt-5.4-mini", "api_base": None},
    )

    async def fake_run_title_turn(prompt: str, session_id: str) -> str:
        assert "Explain provider sync" in prompt
        return '  "Provider sync flow"  '

    monkeypatch.setattr(app_module, "_run_title_generation_turn", fake_run_title_turn)

    import asyncio
    asyncio.run(app_module._generate_session_title(session, "Explain provider sync"))

    assert app_module.session_store.get(session.session_id).title == "Provider sync flow"
    assert app_module.session_store.get(session.session_id).title_generation_state == "done"


def test_generate_title_skips_when_model_not_configured() -> None:
    session = app_module.session_store.create()

    import asyncio
    asyncio.run(app_module._generate_session_title(session, "Hello"))

    stored = app_module.session_store.get(session.session_id)
    assert stored.title is None
    assert stored.title_generation_state == "done"
```

- [ ] **Step 2: Run the focused backend tests to verify failure**

Run: `uv run pytest server/tests/test_app.py -k "title" -q`

Expected: FAIL because helper functions for resolving title models, normalization, and background generation do not exist yet.

- [ ] **Step 3: Implement the backend title workflow**

```python
def _normalize_session_title(value: str) -> str | None:
    normalized = " ".join(value.strip().strip("\"'").split())
    if not normalized:
        return None
    return normalized[:80].rstrip(" .,:;!-")


async def _generate_session_title(session: SessionRecord, first_user_text: str) -> None:
    if not first_user_text.strip():
        session_store.mark_title_generation_done(session.session_id)
        return

    model_entry = _resolve_title_generation_model()
    if model_entry is None:
        session_store.mark_title_generation_done(session.session_id)
        return

    try:
        raw_title = await _run_title_generation_turn(
            first_user_text=first_user_text,
            session_id=session.session_id,
            model_entry=model_entry,
        )
        session_store.set_title(session.session_id, _normalize_session_title(raw_title))
    except Exception:
        logger.exception("[title] generation failed", extra={"session_id": session.session_id})
    finally:
        session_store.mark_title_generation_done(session.session_id)


def _schedule_session_title_generation(session: SessionRecord, first_user_text: str) -> None:
    if not session_store.try_mark_title_generation_running(session.session_id):
        return
    asyncio.create_task(_generate_session_title(session, first_user_text))
```

```python
def _entries_from_in_memory_sessions(limit: int) -> list[SessionEntry]:
    records = sorted(
        session_store.list_records(),
        key=lambda record: record.updated_at,
        reverse=True,
    )
    return [
        SessionEntry(
            session_id=record.session_id,
            title=record.title,
            updated_at=record.updated_at.isoformat(),
        )
        for record in records[:limit]
    ]
```

```python
session, created = session_store.get_or_create(payload.session_id)
session_store.append_turn(session.session_id, "user", payload.input.instruction)
if created:
    _schedule_session_title_generation(session, payload.input.instruction)
```

- [ ] **Step 4: Re-run the focused backend tests to verify they pass**

Run: `uv run pytest server/tests/test_app.py -k "title or sessions" -q`

Expected: PASS with titles exposed through the session list and background generation attempted only once for new sessions.

- [ ] **Step 5: Commit**

```bash
git add server/app.py server/session_store.py server/session_catalog.py server/provider_config_store.py server/schemas.py server/tests/test_app.py
git commit -m "feat: add backend session auto title generation"
```

### Task 3: Add failing frontend tests for settings and session list title display

**Files:**
- Modify: `tests/api-client.test.ts`
- Modify: `src/api-client.ts`
- Modify: `src/session-picker-modal.ts`
- Modify: `src/settings.ts`

- [ ] **Step 1: Write the failing frontend tests**

```ts
describe("parseSessionListResponse", () => {
  it("accepts session titles when provided", () => {
    const parsed = parseSessionListResponse({
      ok: true,
      entries: [
        {
          session_id: "sess_1",
          title: "Summarize config migration",
          updated_at: "2026-04-24T00:00:00+00:00"
        }
      ]
    });

    expect(parsed.entries[0].title).toBe("Summarize config migration");
  });
});

describe("settings defaults", () => {
  it("disables title generation by default", () => {
    expect(DEFAULT_SETTINGS.titleGenerationModelId).toBeNull();
  });
});

describe("SessionPickerModal labels", () => {
  it("prefers title over session id", () => {
    const item: SessionPickerItem = {
      type: "history",
      sessionId: "sess_1",
      title: "Explain provider sync",
      isActive: false,
      updatedAt: null
    };

    const text = SessionPickerModal.prototype.getItemText.call({}, item);

    expect(text).toContain("Explain provider sync");
    expect(text).not.toContain("sess_1 -");
  });
});
```

- [ ] **Step 2: Run frontend tests to verify they fail**

Run: `pnpm test -- --run tests/api-client.test.ts`

Expected: FAIL because the client schema, settings defaults, and picker item types do not yet know about `title` or `titleGenerationModelId`.

- [ ] **Step 3: Add minimal type scaffolding**

```ts
export const sessionEntrySchema = z.object({
  session_id: z.string().min(1),
  title: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional()
});
```

```ts
export interface DontAskMeAgainSettings {
  // existing fields
  titleGenerationModelId: string | null;
}

export const DEFAULT_SETTINGS: DontAskMeAgainSettings = {
  // existing defaults
  titleGenerationModelId: null
};
```

```ts
type SessionPickerItem =
  | { type: "history"; sessionId: string; title?: string | null; isActive: boolean; updatedAt?: string | null };
```

- [ ] **Step 4: Re-run frontend tests to verify failure narrows to rendering and UI wiring**

Run: `pnpm test -- --run tests/api-client.test.ts`

Expected: FAIL only because the picker text and settings UI logic still need implementation.

- [ ] **Step 5: Commit**

```bash
git add tests/api-client.test.ts src/api-client.ts src/session-picker-modal.ts src/settings.ts
git commit -m "test: add frontend coverage for session auto titles"
```

### Task 4: Implement frontend model selection and title-aware session rendering

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/api-client.ts`
- Modify: `src/session-picker-modal.ts`
- Modify: `src/main.ts`
- Modify: `tests/api-client.test.ts`

- [ ] **Step 1: Add one more failing test for settings payload persistence**

```ts
describe("title generation setting persistence", () => {
  it("stores the selected model-provider id", async () => {
    const settings = { ...DEFAULT_SETTINGS, titleGenerationModelId: "model-1" };
    expect(settings.titleGenerationModelId).toBe("model-1");
  });
});
```

- [ ] **Step 2: Run the focused frontend tests to verify failure**

Run: `pnpm test -- --run tests/api-client.test.ts tests/session-manager.test.ts`

Expected: FAIL because the UI layer has not yet exposed or consumed the selected title-model id.

- [ ] **Step 3: Implement the minimal frontend wiring**

```ts
new Setting(containerEl)
  .setName("Title generation model")
  .setDesc("Choose a configured model for automatic session titles, or disable title generation.")
  .addDropdown((dropdown) => {
    dropdown.addOption("", "Disabled");
    for (const entry of this.modelProviders) {
      dropdown.addOption(entry.id, entry.label || entry.model);
    }
    dropdown.setValue(this.plugin.settings.titleGenerationModelId ?? "");
    dropdown.onChange(async (value) => {
      this.plugin.settings.titleGenerationModelId = value || null;
      await this.plugin.saveSettings();
    });
  });
```

```ts
const historyItems: SessionPickerItem[] = options.sessions.map((entry) => ({
  type: "history",
  sessionId: entry.sessionId,
  title: entry.title ?? null,
  isActive: options.activeSessionId === entry.sessionId,
  updatedAt: entry.updatedAt
}));
```

```ts
const label = item.title?.trim() || item.sessionId;
return `${label}${activeTag}${updatedAt}`;
```

- [ ] **Step 4: Re-run the focused frontend tests to verify they pass**

Run: `pnpm test -- --run tests/api-client.test.ts tests/session-manager.test.ts`

Expected: PASS with settings defaults, session parsing, and title-aware rendering all green.

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/api-client.ts src/session-picker-modal.ts src/main.ts tests/api-client.test.ts tests/session-manager.test.ts
git commit -m "feat: add session title model setting and UI display"
```

### Task 5: Verify the integrated feature end to end

**Files:**
- Verify only: `server/app.py`
- Verify only: `src/settings.ts`
- Verify only: `src/session-picker-modal.ts`

- [ ] **Step 1: Run the backend test suite for the changed server modules**

Run: `uv run pytest server/tests/test_app.py server/tests/test_schemas.py server/tests/test_provider_config_store.py -q`

Expected: PASS

- [ ] **Step 2: Run the frontend test suite for the changed plugin modules**

Run: `pnpm test -- --run tests/api-client.test.ts tests/session-manager.test.ts`

Expected: PASS

- [ ] **Step 3: Run the production build**

Run: `pnpm run build`

Expected: build completes successfully with no new type errors

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --stat HEAD~2..HEAD`

Expected: only targeted server and frontend files for session auto title support are included

- [ ] **Step 5: Commit verification-only follow-ups if needed**

```bash
git add server/app.py server/session_store.py server/session_catalog.py server/schemas.py src/settings.ts src/api-client.ts src/session-picker-modal.ts src/main.ts
git commit -m "chore: finalize session auto title support"
```
