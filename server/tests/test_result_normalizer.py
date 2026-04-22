import pytest

from server.result_normalizer import normalize_runtime_result


def test_normalize_runtime_result_accepts_valid_json() -> None:
    result = normalize_runtime_result(
        '{"filename":"entropy-answer","markdown":"# Answer"}',
        "sess_1",
    )

    assert result.session_id == "sess_1"
    assert result.filename == "entropy-answer"


def test_normalize_runtime_result_rejects_missing_filename() -> None:
    with pytest.raises(KeyError):
        normalize_runtime_result('{"markdown":"# Answer"}', "sess_1")
