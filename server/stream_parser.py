from __future__ import annotations


class TaggedStreamParser:
    """Incrementally parse <thinking>/<answer> tagged output into typed deltas."""

    def __init__(self) -> None:
        self._buffer = ""
        self._mode: str | None = None
        self._holdback = 16
        self._seen_tag = False

    def feed(self, delta: str) -> list[tuple[str, str]]:
        if not delta:
            return []
        self._buffer += delta
        return self._drain(final=False)

    def flush(self) -> list[tuple[str, str]]:
        return self._drain(final=True)

    def _emit(self, kind: str, text: str, out: list[tuple[str, str]]) -> None:
        if text:
            out.append((kind, text))

    def _find_tag(self, tag: str) -> int:
        return self._buffer.lower().find(tag)

    def _starts_with_tag(self, tag: str) -> bool:
        return self._buffer.lower().startswith(tag)

    def _drain(self, final: bool) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        while True:
            if self._mode is None:
                idx_th = self._find_tag("<thinking>")
                idx_ans = self._find_tag("<answer>")
                indices = [i for i in [idx_th, idx_ans] if i >= 0]
                if not indices:
                    if final:
                        self._emit("answer_delta", self._buffer, out)
                        self._buffer = ""
                    else:
                        safe_len = max(0, len(self._buffer) - self._holdback)
                        if safe_len > 0:
                            self._emit("answer_delta", self._buffer[:safe_len], out)
                            self._buffer = self._buffer[safe_len:]
                    break

                next_idx = min(indices)
                if next_idx > 0:
                    prefix = self._buffer[:next_idx]
                    if not (not self._seen_tag and prefix.strip() == ""):
                        self._emit("answer_delta", prefix, out)
                    self._buffer = self._buffer[next_idx:]

                if self._starts_with_tag("<thinking>"):
                    self._seen_tag = True
                    self._mode = "thinking"
                    self._buffer = self._buffer[len("<thinking>") :]
                    continue
                if self._starts_with_tag("<answer>"):
                    self._seen_tag = True
                    self._mode = "answer"
                    self._buffer = self._buffer[len("<answer>") :]
                    continue
                break

            if self._mode == "thinking":
                end_idx = self._find_tag("</thinking>")
                if end_idx >= 0:
                    self._emit("thinking_delta", self._buffer[:end_idx], out)
                    self._buffer = self._buffer[end_idx + len("</thinking>") :]
                    self._mode = None
                    continue

                if final:
                    self._emit("thinking_delta", self._buffer, out)
                    self._buffer = ""
                else:
                    safe_len = max(0, len(self._buffer) - self._holdback)
                    if safe_len > 0:
                        self._emit("thinking_delta", self._buffer[:safe_len], out)
                        self._buffer = self._buffer[safe_len:]
                break

            if self._mode == "answer":
                end_idx = self._find_tag("</answer>")
                if end_idx >= 0:
                    self._emit("answer_delta", self._buffer[:end_idx], out)
                    self._buffer = self._buffer[end_idx + len("</answer>") :]
                    self._mode = None
                    continue

                if final:
                    self._emit("answer_delta", self._buffer, out)
                    self._buffer = ""
                else:
                    safe_len = max(0, len(self._buffer) - self._holdback)
                    if safe_len > 0:
                        self._emit("answer_delta", self._buffer[:safe_len], out)
                        self._buffer = self._buffer[safe_len:]
                break

        return out
