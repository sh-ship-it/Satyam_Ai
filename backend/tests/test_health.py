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


# ── a 500 must stay readable in the browser ──────────────────────────────────

async def test_a_500_still_carries_cors_headers():
    """Why this matters more than it looks.

    An unhandled exception unwinds PAST CORSMiddleware to Starlette's outermost
    error handler, so without this the 500 arrives with no
    Access-Control-Allow-Origin, the browser refuses to expose the response, and
    fetch() rejects with "Failed to fetch". Every server error in the app then
    looks like the backend is down. That is exactly how the /documents/encrypt
    latin-1 filename bug hid: clean 500 in the log, "network error" in the UI.

    The handler is called directly because ServerErrorMiddleware re-raises after
    sending, and TestClient throws the response away when it does — an end-to-end
    assertion there would measure the test client, not the app.
    """
    from starlette.requests import Request

    from app.main import app

    handler = app.exception_handlers[Exception]

    def req(origin: str | None) -> Request:
        headers = [(b"host", b"localhost:8000")]
        if origin:
            headers.append((b"origin", origin.encode()))
        return Request({"type": "http", "method": "GET", "path": "/x", "headers": headers})

    good = await handler(req("http://localhost:3000"), RuntimeError("boom"))
    assert good.status_code == 500
    assert good.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert good.headers["access-control-allow-credentials"] == "true"
    assert "Origin" in good.headers["vary"], "or a proxy caches one origin's response"
    # The cause belongs in the log, not on the wire.
    assert b"internal error" in bytes(good.body) and b"boom" not in bytes(good.body)

    # An origin outside the allow-list must not be echoed back.
    for bad in [req("http://evil.test"), req(None)]:
        assert (await handler(bad, RuntimeError("boom"))).headers.get(
            "access-control-allow-origin"
        ) is None
