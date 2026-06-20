"""POST a detected incident candidate to Satyam's review queue."""
import os
import httpx

SATYAM_URL = os.getenv("SATYAM_URL", "http://localhost:8000")
SATYAM_TOKEN = os.getenv("SATYAM_TOKEN", "")  # an L2+ officer JWT from /auth/login


def notify(camera_id: str, confidence: float, candidate_type: str = "vehicle_anomaly",
           lat=None, lng=None, clip_path=None, frame_path=None) -> dict:
    r = httpx.post(
        f"{SATYAM_URL}/api/ops/detect/notify",
        headers={"authorization": f"Bearer {SATYAM_TOKEN}"},
        json={"camera_id": camera_id, "confidence": confidence, "candidate_type": candidate_type,
              "lat": lat, "lng": lng, "clip_path": clip_path, "frame_path": frame_path},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()
