from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_backend"] in ("api", "local")


def test_login_and_me():
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
