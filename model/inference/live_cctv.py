"""Satyam — live CCTV detection (YOLOv8 + ByteTrack).

Run EXACTLY as:
    cd model
    venv\\Scripts\\activate        # Windows  (source venv/bin/activate on macOS/Linux)
    python inference/live_cctv.py

Plays a video with live person/vehicle detection drawn on screen. When a tracked
vehicle stays abnormally stopped, a medium/high-confidence candidate is POSTed to
Satyam's human-review queue (/api/ops/detect/notify), which is what lights up the
"Camera Review" tab and the Live Event Feed.

Drop your own clip at  model/video.mp4  (or pass --video <path>). With no video
it falls back to webcam (source 0). Set SATYAM_TOKEN to an L2+ officer JWT to push
candidates; without it, detection still runs locally (push is skipped on error).
"""
import argparse
import time
from pathlib import Path

import cv2
from ultralytics import YOLO

from notify import notify  # inference/ is on sys.path when run as `python inference/live_cctv.py`

SCRIPT_DIR = Path(__file__).resolve().parent      # model/inference
MODEL_ROOT = SCRIPT_DIR.parent                    # model/

# COCO classes: 0=person, 2=car, 3=motorcycle, 5=bus, 7=truck
PERSON_CLASS = 0
VEHICLE_CLASSES = {2, 3, 5, 7}


def resolve_video(arg: str | None) -> str | int:
    if arg and arg != "0":
        return int(arg) if arg.isdigit() else arg
    for cand in (MODEL_ROOT / "video.mp4", MODEL_ROOT / "inference" / "sample.mp4", MODEL_ROOT.parent / "video.mp4"):
        if cand.exists():
            print(f"\U0001F3AC Using video: {cand}")
            return str(cand)
    print("\u2139\uFE0F  No video.mp4 found \u2014 falling back to webcam (source 0)")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default=None, help="path to a video file, or webcam index")
    ap.add_argument("--camera", default="CAM-001", help="camera_id registered in Satyam")
    ap.add_argument("--weights", default=str(MODEL_ROOT / "yolov8s.pt"))
    ap.add_argument("--stopped-secs", type=float, default=3.0, help="stall time before a candidate fires")
    ap.add_argument("--cooldown", type=float, default=30.0, help="seconds between candidates")
    args = ap.parse_args()

    source = resolve_video(args.video)
    model = YOLO(args.weights)  # auto-downloads yolov8s.pt on first run
    cap = cv2.VideoCapture(source)

    stopped_since: dict[int, float] = {}
    prev_center: dict[int, tuple[float, float]] = {}
    last_fire = 0.0

    print("\u2705 Live CCTV running \u2014 press 'q' to quit")
    while True:
        ok, frame = cap.read()
        if not ok:
            if isinstance(source, str):
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # loop the file
                continue
            break

        res = model.track(frame, tracker="bytetrack.yaml", persist=True, conf=0.4, verbose=False)[0]
        now = time.time()
        people = 0

        if res.boxes is not None and res.boxes.id is not None:
            for box, cls, tid in zip(res.boxes.xyxy, res.boxes.cls, res.boxes.id):
                cls, tid = int(cls), int(tid)
                if cls == PERSON_CLASS:
                    people += 1
                    continue
                if cls not in VEHICLE_CLASSES:
                    continue
                x1, y1, x2, y2 = box.tolist()
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                px, py = prev_center.get(tid, (cx, cy))
                moved = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
                prev_center[tid] = (cx, cy)
                if moved < 2.0:  # essentially stationary
                    stopped_since.setdefault(tid, now)
                    stalled = now - stopped_since[tid]
                    if stalled >= args.stopped_secs and (now - last_fire) > args.cooldown:
                        conf = min(0.95, 0.6 + stalled / 20.0)  # demo confidence ramp
                        last_fire = now
                        print(f"\U0001F6A8 candidate: vehicle {tid} stalled {stalled:.1f}s \u2192 conf {conf:.2f}")
                        try:
                            print("   notify:", notify(args.camera, conf, "vehicle_anomaly"))
                        except Exception as e:  # noqa: BLE001
                            print("   notify skipped:", e)
                else:
                    stopped_since.pop(tid, None)

        annotated = res.plot()
        cv2.putText(annotated, f"Satyam CCTV | people:{people}", (12, 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 200), 2)
        cv2.imshow("Satyam CCTV \u2014 YOLO", annotated)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
