import os
import secrets

os.environ.setdefault("MAYA_AUTH_PASSWORDLESS", "false")

from fastapi.testclient import TestClient

from backend.app import app


client = TestClient(app)


def unique_email(prefix: str = "dj") -> str:
    return f"{prefix}_{secrets.token_hex(4)}@maya.local"


def register_user(password: str = "StartPass123!") -> tuple[str, dict]:
    email = unique_email("user")
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "display_name": "Music Test",
            "dj_name": "Music Test DJ",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return payload["token"], payload["user"]


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_music_providers_endpoint_returns_expected_shape() -> None:
    token, _ = register_user("MusicProvidersPass123!")
    response = client.get("/api/music/providers", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    payload = response.json()
    providers = payload.get("providers") or {}
    assert "spotify" in providers
    assert "deezer" in providers
    assert "apple_music" in providers
    assert providers["spotify"]["provider"] == "spotify"
    assert providers["deezer"]["provider"] == "deezer"
    assert providers["apple_music"]["provider"] == "apple_music"


def test_ai_chat_endpoint_returns_reply() -> None:
    token, _ = register_user("AiChatPass123!")
    response = client.post(
        "/api/ai/chat",
        headers=auth_headers(token),
        json={
            "prompt": "Donne moi un conseil de transition",
            "context": {"liveMode": True},
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload.get("ok") is True
    reply = payload.get("reply") or {}
    assert isinstance(reply.get("text"), str)
    assert reply.get("text")
    assert reply.get("source") in {"local", "openai"}
