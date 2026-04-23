import pytest

from server.result_normalizer import normalize_runtime_result


def test_normalize_runtime_result_accepts_valid_json() -> None:
    result = normalize_runtime_result(
        '{"thinking":"trace","answer":"# Answer"}',
        "sess_1",
    )

    assert result.session_id == "sess_1"
    assert result.thinking == "trace"
    assert result.answer == "# Answer"


def test_normalize_runtime_result_rejects_missing_answer() -> None:
    with pytest.raises(KeyError):
        normalize_runtime_result('{"thinking":"..."}', "sess_1")
