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
    r = client.post("/auth/login", json={"username": "officer1", "role": "investigator"})
    assert r.status_code == 200
    token = r.json()["token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["role"] == "investigator"
