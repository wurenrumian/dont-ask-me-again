import os

from server.packaged_main import resolve_server_bind


def test_resolve_server_bind_defaults() -> None:
    original_host = os.environ.pop("DAMA_SERVER_HOST", None)
    original_port = os.environ.pop("DAMA_SERVER_PORT", None)
    try:
        assert resolve_server_bind() == ("127.0.0.1", 8787)
    finally:
        if original_host is not None:
            os.environ["DAMA_SERVER_HOST"] = original_host
        if original_port is not None:
            os.environ["DAMA_SERVER_PORT"] = original_port


def test_resolve_server_bind_reads_env() -> None:
    original_host = os.environ.get("DAMA_SERVER_HOST")
    original_port = os.environ.get("DAMA_SERVER_PORT")
    os.environ["DAMA_SERVER_HOST"] = "0.0.0.0"
    os.environ["DAMA_SERVER_PORT"] = "9000"
    try:
        assert resolve_server_bind() == ("0.0.0.0", 9000)
    finally:
        if original_host is None:
            os.environ.pop("DAMA_SERVER_HOST", None)
        else:
            os.environ["DAMA_SERVER_HOST"] = original_host
        if original_port is None:
            os.environ.pop("DAMA_SERVER_PORT", None)
        else:
            os.environ["DAMA_SERVER_PORT"] = original_port
