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
            "display_name": "Serato Test",
            "dj_name": "Serato Test DJ",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    return payload["token"], payload["user"]


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_push_serato_connects_only_after_payload_and_maps_decks() -> None:
    token, _ = register_user("SeratoPass123!")
    headers = auth_headers(token)

    connect = client.post(
        "/api/serato/connect",
        headers=headers,
        json={"mode": "push", "ws_url": "", "history_path": "", "feed_path": ""},
    )
    assert connect.status_code == 200, connect.text
    state = connect.json()
    assert state["status"] == "connecting"
    assert state["deckA"] is None
    assert state["deckB"] is None

    push_a = client.post(
        "/api/serato/push",
        headers=headers,
        json={"source": "pytest", "payload": {"deck": 1, "track": {"title": "Track A", "artist": "Artist A", "bpm": 126}}},
    )
    assert push_a.status_code == 200, push_a.text

    push_b = client.post(
        "/api/serato/push",
        headers=headers,
        json={"source": "pytest", "payload": {"deck": "B", "track": {"title": "Track B", "artist": "Artist B", "bpm": 127}}},
    )
    assert push_b.status_code == 200, push_b.text

    status = client.get("/api/serato/status", headers=headers)
    assert status.status_code == 200, status.text
    bridge = status.json()
    assert bridge["status"] == "connected"
    assert bridge["deckA"] is not None
    assert bridge["deckA"]["title"] == "Track A"
    assert bridge["deckB"] is not None
    assert bridge["deckB"]["title"] == "Track B"

    disconnected = client.post("/api/serato/disconnect", headers=headers, json={})
    assert disconnected.status_code == 200, disconnected.text
    data = disconnected.json()
    assert data["status"] == "disconnected"
    assert data["deckA"] is None
    assert data["deckB"] is None


def test_import_manifest_creates_and_updates_user_library() -> None:
    token, _ = register_user("ManifestPass123!")
    headers = auth_headers(token)

    first = client.post(
        "/api/library/import-manifest",
        headers=headers,
        json={
            "source": "pytest_manifest",
            "tracks": [
                {
                    "file_path": "/Users/test/Music/Artist One - First Song.mp3",
                    "title": "First Song",
                    "artist": "Artist One",
                    "bpm": 124.5,
                    "camelot_key": "8A",
                    "duration": 320.0,
                    "energy": 7.1,
                    "note": 7.4,
                },
                {
                    "file_path": "/Users/test/Music/Artist Two - Second Song.wav",
                    "title": "Second Song",
                    "artist": "Artist Two",
                    "bpm": 126.1,
                    "camelot_key": "9A",
                    "duration": 355.0,
                    "energy": 7.9,
                    "note": 8.0,
                },
            ],
        },
    )
    assert first.status_code == 200, first.text
    first_payload = first.json()
    assert (first_payload["created"] + first_payload["updated"]) >= 2
    assert first_payload["linked"] == 2

    second = client.post(
        "/api/library/import-manifest",
        headers=headers,
        json={
            "source": "pytest_manifest",
            "tracks": [
                {
                    "file_path": "/Users/test/Music/Artist One - First Song.mp3",
                    "title": "First Song",
                    "artist": "Artist One",
                    "bpm": 125.0,
                    "camelot_key": "8A",
                    "duration": 321.0,
                    "energy": 7.2,
                    "note": 7.6,
                }
            ],
        },
    )
    assert second.status_code == 200, second.text
    second_payload = second.json()
    assert second_payload["updated"] >= 1

    tracks = client.get("/api/library/tracks?limit=20", headers=headers)
    assert tracks.status_code == 200, tracks.text
    titles = {row["title"] for row in tracks.json()["tracks"]}
    assert "First Song" in titles
    assert "Second Song" in titles
