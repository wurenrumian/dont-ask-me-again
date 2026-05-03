from __future__ import annotations

import os

import uvicorn

from server.app import app


def resolve_server_bind() -> tuple[str, int]:
    host = os.environ.get("DAMA_SERVER_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port_raw = os.environ.get("DAMA_SERVER_PORT", "8787").strip() or "8787"
    return host, int(port_raw)


def main() -> None:
    host, port = resolve_server_bind()
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
