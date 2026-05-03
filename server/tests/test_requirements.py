from pathlib import Path


def test_server_requirements_install_vendored_nanobot() -> None:
    requirements = Path("server/requirements.txt").read_text(encoding="utf-8")
    assert "-e ../vendor/nanobot" in requirements
