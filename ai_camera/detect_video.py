"""Run YOLOv8 on a video file; when a vehicle stays abnormally stopped, notify Satyam.

    SATYAM_TOKEN=<jwt> python detect_video.py --video sample.mp4 --camera CAM-001

This mirrors the EMERGE terminal demo: the video plays with detections drawn,
and a medium/high-confidence candidate is pushed to the human-review queue.
"""
import argparse
import time

import cv2
from ultralytics import YOLO

from notify import notify

VEHICLE_CLASSES = {2, 3, 5, 7}  # car, motorcycle, bus, truck (COCO)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default="0")            # path or webcam index
    ap.add_argument("--camera", default="CAM-001")
    ap.add_argument("--weights", default="yolov8s.pt")
    ap.add_argument("--stopped-secs", type=float, default=2.5)
    args = ap.parse_args()

    model = YOLO(args.weights)
    cap = cv2.VideoCapture(int(args.video) if args.video.isdigit() else args.video)
    stopped_since = None
    fired = False

    while cap.isOpened():
        ok, frame = cap.read()
        if not ok:
            break
        res = model(frame, verbose=False)[0]
        vehicles = [b for b in res.boxes if int(b.cls) in VEHICLE_CLASSES]
        # naive "anomaly": >=1 vehicle present and (for demo) treated as stalled
        if vehicles:
            stopped_since = stopped_since or time.time()
            elapsed = time.time() - stopped_since
            if elapsed >= args.stopped_secs and not fired:
                conf = min(0.95, 0.6 + elapsed / 20)  # demo confidence ramp
                print(f"[detect] candidate conf={conf:.2f} -> Satyam")
                try:
                    print(notify(args.camera, conf, "vehicle_anomaly"))
                except Exception as e:  # noqa: BLE001
                    print("notify failed:", e)
                fired = True
        else:
            stopped_since, fired = None, False

        annotated = res.plot()
        cv2.imshow("Satyam CCTV — YOLO", annotated)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
