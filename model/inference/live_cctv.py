"""Satyam — live CCTV detection (YOLOv8).

Plays a video with live detection. Detects:
- Fights / assaults: multiple people in close proximity with rapid movement
- Suspicious vehicles: tracked vehicle stays stopped for > N seconds
- Crowds: >= CROWD_THRESH people in frame

Pushes candidates to /api/ops/detect/notify so they appear in the
Camera Review tab's live feed and incident queue.

Usage:
    python inference/live_cctv.py --video <path> --camera CAM-001
"""
import argparse
import time
import threading
import sys
from pathlib import Path

import cv2
from ultralytics import YOLO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# inference/ is on sys.path when launched via the backend subprocess
SCRIPT_DIR = Path(__file__).resolve().parent   # model/inference
MODEL_ROOT  = SCRIPT_DIR.parent               # model/

# COCO class IDs
PERSON_CLASS   = 0
VEHICLE_CLASSES = {2, 3, 5, 7}   # car, motorbike, bus, truck

CROWD_THRESH   = 4    # >= N people in one frame → crowd alert
FIGHT_DIST     = 80   # px: pair closer than this AND both moving fast → fight
FIGHT_SPEED    = 6.0  # px/frame: minimum movement to count as "active"
COOLDOWN_SEC   = 15.0 # minimum gap between two alerts of the same type

# Weapon detection: class names (lowercased) that count as a weapon, matched
# against whatever model is loaded. Plain COCO yolov8s.pt has NONE of these —
# drop a weapon-trained model at model/gun.pt (or model/weapon.pt) to enable.
WEAPON_NAMES = {"gun", "pistol", "rifle", "handgun", "firearm", "weapon", "knife"}
WEAPON_CONF  = 0.35   # min confidence for a weapon box to fire an alert
WEAPON_WEIGHTS_CANDIDATES = ("gun.pt", "weapon.pt", "weapons.pt", "gun_yolov8.pt")


# ── MJPEG live-stream server (so the browser shows the annotated boxes) ──────
class _FrameBuffer:
    """Thread-safe holder for the latest annotated JPEG frame."""
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jpg: bytes | None = None
        self._cond = threading.Condition(self._lock)

    def set(self, jpg: bytes) -> None:
        with self._cond:
            self._jpg = jpg
            self._cond.notify_all()

    def get_next(self, timeout: float = 5.0) -> bytes | None:
        with self._cond:
            self._cond.wait(timeout=timeout)
            return self._jpg


_FRAMES = _FrameBuffer()


class _MJPEGHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args) -> None:  # silence per-request logging
        pass

    def do_GET(self) -> None:
        if self.path not in ("/stream", "/stream.mjpg", "/"):
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Age", "0")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Content-Type", "multipart/x-mixed-replace; boundary=--frameboundary"
        )
        self.end_headers()
        try:
            while True:
                jpg = _FRAMES.get_next()
                if jpg is None:
                    continue
                self.wfile.write(b"--frameboundary\r\n")
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(jpg)}\r\n\r\n".encode())
                self.wfile.write(jpg)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass  # client (browser tab) disconnected — normal


def _start_mjpeg_server(port: int) -> None:
    try:
        srv = ThreadingHTTPServer(("0.0.0.0", port), _MJPEGHandler)
        print(f"📺 MJPEG stream on http://localhost:{port}/stream", flush=True)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    except Exception as exc:
        print(f"⚠️  Could not start MJPEG server on :{port}: {exc}", flush=True)


def resolve_video(arg: str | None) -> str | int:
    if arg and not arg.isdigit():
        return arg
    if arg and arg.isdigit():
        return int(arg)
    # fallback candidates
    for cand in (
        MODEL_ROOT / "video.mp4",
        MODEL_ROOT / "inference" / "sample.mp4",
        MODEL_ROOT.parent / "video.mp4",
    ):
        if cand.exists():
            print(f"🎬 Using video: {cand}")
            return str(cand)
    print("ℹ️  No video found — falling back to webcam (source 0)")
    return 0


def _notify_bg(camera_id: str, confidence: float, candidate_type: str) -> None:
    """Fire-and-forget POST in a daemon thread so it never blocks the main loop."""
    try:
        from notify import notify
        result = notify(camera_id, confidence, candidate_type)
        print(f"   notify OK: {result}")
    except Exception as exc:
        print(f"   notify skipped: {exc}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video",        default=None)
    ap.add_argument("--camera",       default="CAM-001")
    ap.add_argument("--weights",      default=str(MODEL_ROOT / "yolov8s.pt"))
    ap.add_argument("--weapon-weights", default=None,
                    help="path to a weapon/gun-trained YOLO model (optional)")
    ap.add_argument("--stopped-secs", type=float, default=3.0)
    ap.add_argument("--cooldown",     type=float, default=COOLDOWN_SEC)
    ap.add_argument("--no-display", action="store_true",
                    help="run headless (no cv2 window) — used when launched by the backend")
    ap.add_argument("--mjpeg-port", type=int, default=8089,
                    help="port for the annotated MJPEG live stream (0 = disabled)")
    args = ap.parse_args()

    if args.mjpeg_port:
        _start_mjpeg_server(args.mjpeg_port)

    source = resolve_video(args.video)
    print(f"⏳ Loading model: {args.weights}")
    sys.stdout.flush()

    model = YOLO(args.weights)
    primary_names = {i: str(n).lower() for i, n in model.names.items()}

    # ── Optional dedicated weapon model ───────────────────────────────────
    weapon_model = None
    weapon_names: dict[int, str] = {}
    weapon_path = None
    if args.weapon_weights:
        weapon_path = Path(args.weapon_weights)
    else:
        for cand in WEAPON_WEIGHTS_CANDIDATES:
            p = MODEL_ROOT / cand
            if p.exists():
                weapon_path = p
                break
    if weapon_path and weapon_path.exists():
        try:
            weapon_model = YOLO(str(weapon_path))
            weapon_names = {i: str(n).lower() for i, n in weapon_model.names.items()}
            print(f"🔫 Weapon model loaded: {weapon_path}", flush=True)
        except Exception as exc:
            print(f"⚠️  Could not load weapon model {weapon_path}: {exc}", flush=True)
    else:
        if any(n in WEAPON_NAMES for n in primary_names.values()):
            print("🔫 Primary model has weapon classes — gun detection enabled.", flush=True)
        else:
            print("ℹ️  No weapon model found (model/gun.pt). Gun detection idle — "
                  "drop a weapon-trained .pt in model/ to enable.", flush=True)

    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        print(f"❌ Cannot open video source: {source}", flush=True)
        return

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

    # Per-track state
    stopped_since: dict[int, float] = {}
    prev_center:   dict[int, tuple[float, float]] = {}
    prev_speed:    dict[int, float] = {}

    # Per-type cooldown
    last_fire: dict[str, float] = {}

    def can_fire(ctype: str) -> bool:
        return time.time() - last_fire.get(ctype, 0.0) > args.cooldown

    def fire(ctype: str, conf: float) -> None:
        last_fire[ctype] = time.time()
        print(f"🚨 {ctype} | conf={conf:.2f}", flush=True)
        t = threading.Thread(target=_notify_bg, args=(args.camera, conf, ctype), daemon=True)
        t.start()

    print("✅ Live CCTV running — press 'q' in the window to quit", flush=True)
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            if isinstance(source, str):
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)   # loop the file
                frame_idx = 0
                continue
            break

        frame_idx += 1
        now = time.time()

        res = model.track(
            frame, tracker="bytetrack.yaml", persist=True,
            conf=0.35, verbose=False,
        )[0]

        # ── Weapon / gun detection ────────────────────────────────────────
        # (a) weapon classes inside the primary model's own detections
        if res.boxes is not None and len(res.boxes) > 0 and can_fire("weapon"):
            for cls_t, conf_t in zip(res.boxes.cls, res.boxes.conf):
                name = primary_names.get(int(cls_t), "")
                if name in WEAPON_NAMES and float(conf_t) >= WEAPON_CONF:
                    fire("weapon", min(0.97, float(conf_t)))
                    break
        # (b) dedicated weapon model, if one was loaded
        if weapon_model is not None and can_fire("weapon"):
            try:
                wres = weapon_model.predict(frame, conf=WEAPON_CONF, verbose=False)[0]
                if wres.boxes is not None and len(wres.boxes) > 0:
                    best = max(float(c) for c in wres.boxes.conf)
                    fire("weapon", min(0.97, best))
            except Exception as exc:
                print(f"   weapon infer error: {exc}", flush=True)

        # ── Collect person positions + speeds ─────────────────────────────
        person_centers: list[tuple[float, float]] = []
        person_speeds:  list[float]               = []
        seen_tids: set[int] = set()

        if res.boxes is not None and res.boxes.id is not None:
            for box, cls_t, tid_t in zip(res.boxes.xyxy, res.boxes.cls, res.boxes.id):
                cls, tid = int(cls_t), int(tid_t)
                seen_tids.add(tid)
                x1, y1, x2, y2 = map(float, box.tolist())
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2

                px, py = prev_center.get(tid, (cx, cy))
                speed  = ((cx - px)**2 + (cy - py)**2) ** 0.5
                prev_center[tid] = (cx, cy)
                prev_speed[tid]  = speed

                if cls == PERSON_CLASS:
                    person_centers.append((cx, cy))
                    person_speeds.append(speed)

                elif cls in VEHICLE_CLASSES:
                    if speed < 2.0:
                        stopped_since.setdefault(tid, now)
                        stalled = now - stopped_since[tid]
                        if stalled >= args.stopped_secs and can_fire("vehicle_anomaly"):
                            conf = min(0.95, 0.6 + stalled / 20.0)
                            fire("vehicle_anomaly", conf)
                    else:
                        stopped_since.pop(tid, None)

        # Evict track IDs no longer visible so the per-track dicts can't grow
        # without bound over a long stream.
        if frame_idx % 300 == 0:
            for d in (prev_center, prev_speed, stopped_since):
                for gone in [k for k in d if k not in seen_tids]:
                    d.pop(gone, None)

        n_people = len(person_centers)

        # ── Crowd detection ───────────────────────────────────────────────
        if n_people >= CROWD_THRESH and can_fire("crowd"):
            conf = min(0.90, 0.55 + n_people * 0.04)
            fire("crowd", conf)

        # ── Fight detection ───────────────────────────────────────────────
        # Two or more people within FIGHT_DIST px AND at least one moving fast
        if n_people >= 2 and can_fire("fight"):
            fight_pairs = 0
            for i in range(n_people):
                for j in range(i + 1, n_people):
                    dx = person_centers[i][0] - person_centers[j][0]
                    dy = person_centers[i][1] - person_centers[j][1]
                    dist = (dx*dx + dy*dy) ** 0.5
                    if dist < FIGHT_DIST:
                        if person_speeds[i] > FIGHT_SPEED or person_speeds[j] > FIGHT_SPEED:
                            fight_pairs += 1
            if fight_pairs >= 1:
                conf = min(0.92, 0.65 + fight_pairs * 0.05)
                fire("fight", conf)

        # ── Annotate (always, for the MJPEG stream) + optional window ──────
        annotated = res.plot()
        cv2.putText(annotated, f"Satyam CCTV  |  people:{n_people}", (14, 36),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 200), 2)

        # Banner the most recent alert so judges see WHAT was detected.
        if last_fire:
            recent_type = max(last_fire, key=last_fire.get)
            if now - last_fire[recent_type] < 2.5:
                txt = f"DETECTED: {recent_type.replace('_', ' ').upper()}"
                cv2.putText(annotated, txt, (14, 74),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.95, (40, 40, 255), 3)

        if args.mjpeg_port:
            ok_enc, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ok_enc:
                _FRAMES.set(buf.tobytes())

        if not args.no_display:
            try:
                cv2.imshow("Satyam CCTV — YOLO", annotated)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            except cv2.error:
                # No GUI available — fall back to headless for the rest of the run.
                args.no_display = True
        else:
            # Headless: throttle roughly to the source frame rate so the stream
            # plays at real-time speed instead of racing through the clip.
            time.sleep(max(0.0, 1.0 / fps))

    cap.release()
    cv2.destroyAllWindows()
    print("🛑 CCTV stopped.", flush=True)


if __name__ == "__main__":
    main()
