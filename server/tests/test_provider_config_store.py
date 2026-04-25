from pathlib import Path
from uuid import uuid4

from server.provider_config_store import (
    delete_model_provider,
    list_model_providers,
    save_model_provider,
)
from server.provider_secret_store import get_provider_api_key
from server.schemas import (
    ModelProviderDeleteRequest,
    ModelProviderSaveRequest,
)


def _make_workspace_dir() -> Path:
    workspace = Path(".tmp-test-data") / f"provider-config-{uuid4().hex}"
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace.resolve()


def test_list_model_providers_empty() -> None:
    """测试空列表返回"""
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    result = list_model_providers(tmp_path)
    assert result.ok is True
    assert result.entries == []
    assert result.default_id is None


def test_save_and_list_model_provider() -> None:
    """测试保存和列出 model provider"""
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    # 保存一个新的 model provider
    save_result = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="openai",
            model="gpt-4.1",
            api_base="https://api.openai.com/v1",
            label="My GPT-4",
            is_default=True,
        ),
    )

    assert save_result.ok is True
    assert save_result.entry.provider == "openai"
    assert save_result.entry.model == "gpt-4.1"
    assert save_result.entry.label == "My GPT-4"
    assert save_result.entry.is_default is True

    # 列出所有
    list_result = list_model_providers(tmp_path)
    assert list_result.ok is True
    assert len(list_result.entries) == 1
    assert list_result.entries[0].provider == "openai"
    assert list_result.entries[0].model == "gpt-4.1"
    assert list_result.default_id == save_result.entry.id


def test_save_model_provider_splits_provider_and_model_with_dedicated_key() -> None:
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    save_result = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="openai_compatible",
            provider_name="Packy",
            model="gpt-image-2",
            api_base="https://www.packyapi.com/v1",
            api_key="packy-key",
            label="Packy image",
            capabilities=["image"],
        ),
    )

    assert save_result.entry.provider_name == "Packy"
    assert save_result.entry.provider_kind == "openai_compatible"
    assert save_result.entry.api_base == "https://www.packyapi.com/v1"
    assert save_result.entry.capabilities == ["image"]
    assert save_result.entry.has_api_key is True
    assert save_result.entry.provider_id is not None
    assert get_provider_api_key(tmp_path, save_result.entry.provider_id) == "packy-key"
    assert not (server_dir / ".env").exists()


def test_adds_multiple_models_under_one_provider_without_key_conflict() -> None:
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    first = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="openai_compatible",
            provider_name="Packy",
            model="gpt-image-2",
            api_base="https://www.packyapi.com/v1",
            api_key="packy-key",
            capabilities=["image"],
        ),
    )
    second = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="openai_compatible",
            provider_id=first.entry.provider_id,
            provider_name="Packy",
            model="gpt-image-2-fast",
            api_base="https://www.packyapi.com/v1",
            capabilities=["image"],
        ),
    )

    listed = list_model_providers(tmp_path).entries
    assert {entry.model for entry in listed} == {"gpt-image-2", "gpt-image-2-fast"}
    assert len({entry.provider_id for entry in listed}) == 1
    assert all(entry.has_api_key for entry in listed)
    assert second.entry.provider_id == first.entry.provider_id


def test_save_multiple_providers_and_set_default() -> None:
    """测试保存多个 provider 并设置默认"""
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    # 保存第一个（不设为默认）
    result1 = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="anthropic",
            model="claude-sonnet-4.5",
            is_default=False,
        ),
    )

    # 保存第二个（设为默认）
    result2 = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="openai",
            model="gpt-4.1",
            is_default=True,
        ),
    )

    # 验证
    list_result = list_model_providers(tmp_path)
    assert len(list_result.entries) == 2
    assert list_result.default_id == result2.entry.id

    # 找到默认项
    default_entry = next(e for e in list_result.entries if e.is_default)
    assert default_entry.provider == "openai"
    assert default_entry.model == "gpt-4.1"


def test_update_model_provider() -> None:
    """测试更新已存在的 model provider"""
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    # 创建
    create_result = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="openai",
            model="gpt-4",
        ),
    )

    # 更新
    update_result = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            id=create_result.entry.id,
            provider="openai",
            model="gpt-4.1",
            label="Updated GPT-4",
        ),
    )

    assert update_result.ok is True
    assert update_result.entry.id == create_result.entry.id
    assert update_result.entry.model == "gpt-4.1"
    assert update_result.entry.label == "Updated GPT-4"

    # 验证只有一条记录
    list_result = list_model_providers(tmp_path)
    assert len(list_result.entries) == 1


def test_delete_model_provider() -> None:
    """测试删除 model provider"""
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    # 创建两个
    result1 = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(provider="openai", model="gpt-4"),
    )
    result2 = save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(provider="anthropic", model="claude-3"),
    )

    # 删除第一个
    delete_result = delete_model_provider(
        tmp_path,
        ModelProviderDeleteRequest(id=result1.entry.id),
    )

    assert delete_result.ok is True

    # 验证只剩一个
    list_result = list_model_providers(tmp_path)
    assert len(list_result.entries) == 1
    assert list_result.entries[0].id == result2.entry.id


def test_delete_nonexistent_returns_ok() -> None:
    """测试删除不存在的 ID 返回成功"""
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)

    delete_result = delete_model_provider(
        tmp_path,
        ModelProviderDeleteRequest(id="nonexistent-id"),
    )

    assert delete_result.ok is True


def test_list_does_not_bootstrap_old_runtime_provider_defaults() -> None:
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)
    (server_dir / "nanobot.config.json").write_text(
        """{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "apiBase": "https://api.openai.com/v1"
    }
  },
  "agents": {
    "defaults": {
      "provider": "openai",
      "model": "gpt-4.1"
    }
  }
}""",
        encoding="utf-8",
    )

    result = list_model_providers(tmp_path)

    assert result.ok is True
    assert result.entries == []
    assert result.default_id is None


def test_save_model_provider_syncs_runtime_provider_defaults() -> None:
    tmp_path = _make_workspace_dir()
    server_dir = tmp_path / "server"
    server_dir.mkdir(parents=True, exist_ok=True)
    (server_dir / "nanobot.config.example.json").write_text(
        '{"agents":{"defaults":{"workspace":"./.runtime/nanobot-workspace"}},"tools":{"web":{"enable":false},"exec":{"enable":false},"restrictToWorkspace":true}}',
        encoding="utf-8",
    )

    save_model_provider(
        tmp_path,
        ModelProviderSaveRequest(
            provider="anthropic",
            model="claude-sonnet-4.5",
            api_base="https://api.anthropic.com",
            is_default=True,
        ),
    )

    config = (server_dir / "nanobot.config.json").read_text(encoding="utf-8")
    assert '"provider": "anthropic"' in config
    assert '"model": "claude-sonnet-4.5"' in config
    assert '"apiBase": "https://api.anthropic.com"' in config
    assert '"workspace": "./.runtime/nanobot-workspace"' in config
