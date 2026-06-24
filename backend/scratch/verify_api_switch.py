import httpx
import json

BASE_URL = "http://127.0.0.1:8000"

def test_flow():
    # 1. Attempt dynamic login based on active DB state
    print("[INFO] Attempting login...")
    token = None
    username = None
    
    # Try local user first
    try:
        login_res = httpx.post(f"{BASE_URL}/auth/login", json={"username": "officer1", "password": ""})
        if login_res.status_code == 200:
            token = login_res.json()["token"]
            username = "officer1"
            print("[SUCCESS] Logged in successfully as local user 'officer1'. (Backend is in LOCAL mode)")
    except Exception as e:
        pass

    # If local user fails, try cloud user
    if not token:
        try:
            login_res = httpx.post(f"{BASE_URL}/auth/login", json={"username": "demo", "password": ""})
            if login_res.status_code == 200:
                token = login_res.json()["token"]
                username = "demo"
                print("[SUCCESS] Logged in successfully as cloud user 'demo'. (Backend is in CLOUD mode)")
            else:
                print(f"[ERROR] Cloud login returned status {login_res.status_code}: {login_res.text}")
        except Exception as e:
            print(f"[ERROR] Cloud login failed: {e}")
            
    if not token:
        print("[ERROR] Failed to authenticate with any user on the running backend.")
        return

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 2. Switch database source to 'local'
    print("\n[INFO] Switching database source to 'local'...")
    try:
        switch_res = httpx.post(f"{BASE_URL}/settings/db-source", json={"source": "local"}, headers=headers)
        switch_res.raise_for_status()
        print(f"[SUCCESS] Switched database source. Response: {switch_res.json()}")
    except Exception as e:
        print(f"[ERROR] Failed to switch database source to 'local': {e}")
        return

    # 3. Verify current database source is indeed 'local'
    try:
        get_res = httpx.get(f"{BASE_URL}/settings/db-source", headers=headers)
        get_res.raise_for_status()
        print(f"[INFO] Current active database settings: {get_res.json()}")
    except Exception as e:
        print(f"[ERROR] Failed to fetch current database source: {e}")

    # 4. Fetch map hotspots (this queries the database and runs RLS policies)
    print("\n[INFO] Fetching map hotspots from 'local' database...")
    try:
        hotspots_res = httpx.post(f"{BASE_URL}/map/hotspots", json={"mode": "by_crime"}, headers=headers)
        hotspots_res.raise_for_status()
        hotspots_data = hotspots_res.json()
        print(f"[SUCCESS] Successfully fetched hotspots from local database!")
        print(f"          Total hotspots: {hotspots_data.get('total', 0)}")
        print(f"          Points returned: {len(hotspots_data.get('points', []))}")
    except Exception as e:
        print(f"[ERROR] Failed to fetch hotspots from local database: {e}")
        if 'hotspots_res' in locals():
            print(f"Response: {hotspots_res.text}")

    # 5. Fetch station breakdown
    print("\n[INFO] Fetching station breakdown from 'local' database...")
    try:
        breakdown_res = httpx.post(f"{BASE_URL}/map/station-breakdown", json={"mode": "by_crime", "limit": 5}, headers=headers)
        breakdown_res.raise_for_status()
        breakdown_data = breakdown_res.json()
        print(f"[SUCCESS] Successfully fetched station breakdown from local database!")
        print(f"          Total stations: {breakdown_data.get('total', 0)}")
        print(f"          Rows returned: {len(breakdown_data.get('rows', []))}")
    except Exception as e:
        print(f"[ERROR] Failed to fetch station breakdown from local database: {e}")
        if 'breakdown_res' in locals():
            print(f"Response: {breakdown_res.text}")

    # 6. Switch database source back to 'cloud' to restore original state if needed
    print("\n[INFO] Switching database source back to 'cloud'...")
    try:
        switch_res = httpx.post(f"{BASE_URL}/settings/db-source", json={"source": "cloud"}, headers=headers)
        switch_res.raise_for_status()
        print(f"[SUCCESS] Switched database source back to 'cloud'. Response: {switch_res.json()}")
    except Exception as e:
        print(f"[ERROR] Failed to switch database source back to 'cloud': {e}")

if __name__ == "__main__":
    test_flow()
