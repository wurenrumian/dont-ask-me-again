from __future__ import annotations

import json
import re

from server.schemas import InvokeResult


def _extract_json_object(raw_output: str) -> str:
    fenced_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_output, re.DOTALL)
    if fenced_match:
        return fenced_match.group(1)

    start = raw_output.find("{")
    end = raw_output.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("Runtime output does not contain a JSON object.")

    return raw_output[start : end + 1]


def normalize_runtime_result(raw_output: str, session_id: str) -> InvokeResult:
    thinking_match = re.search(r"<thinking>(.*?)</thinking>", raw_output, re.DOTALL | re.IGNORECASE)
    answer_match = re.search(r"<answer>(.*?)</answer>", raw_output, re.DOTALL | re.IGNORECASE)

    if thinking_match or answer_match:
        return InvokeResult(
            session_id=session_id,
            thinking=(thinking_match.group(1) if thinking_match else ""),
            answer=(answer_match.group(1) if answer_match else raw_output),
        )

    data = json.loads(_extract_json_object(raw_output))
    return InvokeResult(
        session_id=session_id,
        thinking=str(data.get("thinking", "")),
        answer=str(data["answer"]),
    )
