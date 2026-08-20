import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_backend"] in ("api", "local")


@pytest.mark.integration
def test_login_and_me():
    """Requires a live, seeded database.

    Marked `integration` because it registers and then logs in a real user. On a
    persistent database the account survives between runs, so the second run
    hits the existing row with a different password and gets 401. It also has to
    clear the private `_engines` / `_sessionmakers` caches in app.db.session,
    which is a symptom of the process-global db-source design rather than
    something the test should be doing.

    Run explicitly with: pytest -m integration
    """
    from app.db.session import _engines, _sessionmakers
    _engines.clear()
    _sessionmakers.clear()
    client.post("/auth/register", json={
        "name": "Officer One",
        "email": "officer1@ksp.gov.in",
        "password": "demo",
        "role": "PSI"
    })
    _engines.clear()
    _sessionmakers.clear()
    r = client.post("/auth/login", json={"username": "officer1", "password": "demo"})
    assert r.status_code == 200
    _engines.clear()
    _sessionmakers.clear()
    token = r.json()["token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["rank"] == "PSI"
