import httpx
import json

base_url = "http://127.0.0.1:8000"

try:
    # 1. Log in
    login_resp = httpx.post(f"{base_url}/auth/login", json={"username": "test", "password": "test"})
    print("Login status:", login_resp.status_code)
    print("Login response text:", login_resp.text)
    login_data = login_resp.json()
    token = login_data["token"]
    print("Logged in successfully. Token length:", len(token))

    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get camera status
    status_resp = httpx.get(f"{base_url}/api/ops/camera/status", headers=headers)
    print("Initial Camera status:", status_resp.status_code, status_resp.json())

    # 3. Start camera
    start_resp = httpx.post(f"{base_url}/api/ops/camera/start", headers=headers)
    print("Start Camera status:", start_resp.status_code, start_resp.json())

    # 4. Wait a bit
    import time
    time.sleep(2)

    # 5. Check camera status again
    status_resp2 = httpx.get(f"{base_url}/api/ops/camera/status", headers=headers)
    print("After-start Camera status:", status_resp2.status_code, status_resp2.json())

except Exception as e:
    print("Error:", e)
