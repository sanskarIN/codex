from __future__ import annotations

import pytest

from openai_codex._initialize_metadata import _split_user_agent, validate_initialize_metadata
from openai_codex.models import InitializeResponse, ServerInfo


@pytest.mark.parametrize(
    ("user_agent", "expected"),
    [
        ("codex/0.167.0-alpha.4.1 (Windows 10; x86_64) dumb (codex_python_sdk; 0.0.0-dev)",
         ("codex", "0.167.0-alpha.4.1")),
        ("codex/0.169.0 (Linux; x86_64)", ("codex", "0.169.0")),
        ("codex/0.170.0-alpha.2", ("codex", "0.170.0-alpha.2")),
        ("codex/", ("codex", None)),
        ("", (None, None)),
    ],
)
def test_split_user_agent_extracts_only_version_token(
    user_agent: str, expected: tuple[str | None, str | None]
) -> None:
    assert _split_user_agent(user_agent) == expected


def test_initialize_uses_version_token_but_keeps_full_user_agent() -> None:
    user_agent = "codex/0.169.0 (Windows; x86_64) pwsh (codex_python_sdk; dev)"
    metadata = InitializeResponse(userAgent=user_agent)

    result = validate_initialize_metadata(metadata)

    assert result.userAgent == user_agent
    assert result.serverInfo is not None
    assert result.serverInfo.name == "codex"
    assert result.serverInfo.version == "0.169.0"


def test_initialize_preserves_explicit_server_version() -> None:
    metadata = InitializeResponse(
        userAgent="codex/0.169.0 (Windows; x86_64)",
        serverInfo=ServerInfo(name="codex", version="custom-build"),
    )

    result = validate_initialize_metadata(metadata)

    assert result.serverInfo is not None
    assert result.serverInfo.version == "custom-build"


def test_initialize_uses_user_agent_for_missing_server_version_only() -> None:
    metadata = InitializeResponse(
        userAgent="codex/0.169.0 (Linux; x86_64)",
        serverInfo=ServerInfo(name="custom-server"),
    )

    result = validate_initialize_metadata(metadata)

    assert result.serverInfo is not None
    assert result.serverInfo.name == "custom-server"
    assert result.serverInfo.version == "0.169.0"
