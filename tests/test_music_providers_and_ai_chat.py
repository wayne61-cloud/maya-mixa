import os
import secrets

os.environ.setdefault("MAYA_AUTH_PASSWORDLESS", "false")

from fastapi.testclient import TestClient

from backend.app import app, db


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


def test_music_providers_endpoint_is_disabled_and_explains_fallback() -> None:
    token, _ = register_user("MusicProvidersPass123!")
    response = client.get("/api/music/providers", headers=auth_headers(token))
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload.get("enabled") is False
    assert payload.get("providers") == {}
    message = str(payload.get("message") or "").lower()
    assert "recherche globale internet" in message


def test_music_provider_sync_endpoint_returns_410_when_disabled() -> None:
    token, _ = register_user("ProviderSyncDisabled123!")
    response = client.post("/api/music/providers/spotify/sync", headers=auth_headers(token), json={"limit": 50})
    assert response.status_code == 410, response.text
    detail = str(response.json().get("detail") or "").lower()
    assert "désactivée" in detail


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


def test_external_import_local_accepts_incomplete_metadata_with_defaults() -> None:
    token, user = register_user("ExtImportPass123!")
    headers = auth_headers(token)

    unique_id = f"pytest-ext-{secrets.token_hex(6)}"
    external = db.upsert_external_track(
        {
            "source": "pytest",
            "source_track_id": unique_id,
            "source_url": "",
            "title": "Incomplete External Track",
            "artist": "External Artist",
            "version": "",
            "duration": None,
            "bpm": None,
            "musical_key": "",
            "camelot_key": "",
            "energy": None,
            "note": None,
            "genre": "unknown",
            "tags": [],
            "mood_tags": [],
            "confidence": 0.0,
            "metadata": {"source": "pytest", "source_track_id": unique_id},
            "intelligence": {"features": {}, "deep": False},
        }
    )

    response = client.post(f"/api/external/{external['id']}/import-local", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    track = payload.get("track") or {}
    assert float(track.get("bpm") or 0) > 0
    assert float(track.get("duration") or 0) > 0
    assert track.get("camelot_key") or track.get("musical_key")

    tracks = client.get("/api/library/tracks?limit=50", headers=headers)
    assert tracks.status_code == 200, tracks.text
    titles = [row.get("title") for row in tracks.json().get("tracks") or []]
    assert "Incomplete External Track" in titles


def test_search_unified_computes_compatibility_from_live_serato_deck_without_track_id(monkeypatch) -> None:
    token, user = register_user("SearchCompatPass123!")
    headers = auth_headers(token)

    monkeypatch.setattr("backend.app.music_hub.search", lambda q, limit=20: [])

    connect = client.post("/api/serato/connect", headers=headers, json={})
    assert connect.status_code == 200, connect.text

    push = client.post(
        "/api/serato/push",
        headers=headers,
        json={
            "source": "pytest-serato",
            "payload": {
                "deckA": {
                    "track": {
                        "title": "Live Deck Track",
                        "artist": "Deck Artist",
                        "bpm": 126.0,
                        "key": "8A",
                    },
                    "position": 90.0,
                }
            },
        },
    )
    assert push.status_code == 200, push.text

    query = f"pytest-search-{secrets.token_hex(4)}"
    source_track_id = f"{query}-id"
    db.upsert_external_track(
        {
            "source": "pytest",
            "source_track_id": source_track_id,
            "source_url": "",
            "title": query,
            "artist": "Search External",
            "version": "",
            "duration": None,
            "bpm": None,
            "musical_key": "",
            "camelot_key": "",
            "energy": None,
            "note": None,
            "genre": "unknown",
            "tags": [],
            "mood_tags": [],
            "confidence": 0.0,
            "metadata": {"source": "pytest", "source_track_id": source_track_id},
            "intelligence": {"features": {}, "deep": False},
        }
    )

    response = client.get(f"/api/search/unified?q={query}&limit=10", headers=headers)
    assert response.status_code == 200, response.text
    payload = response.json()
    rows = payload.get("global") or []
    target = next((row for row in rows if str(row.get("source_track_id")) == source_track_id), None)
    assert target is not None
    assert target.get("current_track_compatibility") is not None
    assert target.get("current_track_difficulty") in {"easy", "medium", "hard"}


def test_external_detail_returns_fallback_metrics_when_source_metadata_is_sparse(monkeypatch) -> None:
    token, _ = register_user("ExternalDetailDefaults123!")
    headers = auth_headers(token)

    sparse_source_track_id = f"sparse-{secrets.token_hex(4)}"
    monkeypatch.setattr(
        "backend.app.music_hub.search",
        lambda q, limit=20: [
            {
                "source": "pytest",
                "source_track_id": sparse_source_track_id,
                "source_url": "",
                "title": "Sparse External",
                "artist": "Sparse Artist",
                "duration": None,
                "bpm": None,
                "musical_key": "",
                "camelot_key": "",
                "energy": None,
                "note": None,
                "genre": "unknown",
                "tags": [],
                "metadata": {},
            }
        ],
    )

    search = client.get("/api/search/unified?q=sparse&limit=5", headers=headers)
    assert search.status_code == 200, search.text
    rows = search.json().get("global") or []
    assert rows, "Expected at least one external row"

    external_id = int(rows[0]["id"])
    detail = client.get(f"/api/external/{external_id}?deep=true&matches_limit=5", headers=headers)
    assert detail.status_code == 200, detail.text
    payload = detail.json()
    external = payload.get("external") or {}
    assert float(external.get("bpm") or 0) > 0
    assert float(external.get("energy") or 0) > 0
    assert float(external.get("note") or 0) > 0
    assert external.get("camelot_key") or external.get("musical_key")
    assert payload.get("currentCompatibility") is not None
    assert payload.get("analysisContext", {}).get("mode") in {"baseline", "current_track"}
