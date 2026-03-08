import os
import secrets

os.environ.setdefault("MAYA_ALLOW_DEBUG_RESET_TOKEN", "true")
os.environ.setdefault("MAYA_AUTH_PASSWORDLESS", "false")

from fastapi.testclient import TestClient

from backend.app import app, build_reset_token, db, token_hash


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
            "display_name": "Test User",
            "dj_name": "Test DJ",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    token = payload["token"]
    user = payload["user"]
    return token, user


def test_protected_endpoints_require_auth() -> None:
    assert client.get("/api/library/tracks").status_code == 401
    assert client.get("/api/history/summary").status_code == 401
    assert client.get("/api/serato/status").status_code == 401


def test_forgot_reset_password_flow_and_session_revocation() -> None:
    start_password = "StartPass123!"
    new_password = "NewPass456!"
    token, user = register_user(start_password)
    headers = {"Authorization": f"Bearer {token}"}

    forgot = client.post("/api/auth/forgot-password", json={"email": user["email"]})
    assert forgot.status_code == 200, forgot.text
    forgot_payload = forgot.json()
    debug_token = forgot_payload.get("debug_reset_token")

    if not debug_token:
        debug_token = build_reset_token()
        db.create_password_reset_token(int(user["id"]), token_hash(debug_token))

    reset = client.post(
        "/api/auth/reset-password",
        json={"token": debug_token, "new_password": new_password},
    )
    assert reset.status_code == 200, reset.text

    # old session must be revoked after reset
    assert client.get("/api/auth/me", headers=headers).status_code == 401

    login_old = client.post("/api/auth/login", json={"email": user["email"], "password": start_password})
    assert login_old.status_code == 401

    login_new = client.post("/api/auth/login", json={"email": user["email"], "password": new_password})
    assert login_new.status_code == 200, login_new.text


def test_profile_and_session_are_scoped_per_user() -> None:
    token_a, _ = register_user("ScopePass123!")
    token_b, _ = register_user("ScopePass456!")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    start_a = client.post("/api/sessions/start", headers=headers_a, json={"name": "A session", "profile_id": None})
    assert start_a.status_code == 200, start_a.text
    session_id_a = int(start_a.json()["id"])

    # user B should not access/export user A session data
    export_b = client.get(f"/api/export/session/{session_id_a}.json", headers=headers_b)
    assert export_b.status_code == 404

    current_a = client.get("/api/sessions/current", headers=headers_a)
    current_b = client.get("/api/sessions/current", headers=headers_b)
    assert current_a.status_code == 200
    assert current_b.status_code == 200
    assert current_a.json()["session"] is not None
    assert current_b.json()["session"] is None
