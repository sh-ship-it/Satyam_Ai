import sys
import subprocess
import os
import shutil

def _resolve_python() -> str:
    candidates: list[str] = []
    env_py = os.getenv("YOLO_PYTHON")
    if env_py:
        candidates.append(env_py)
    candidates.append(sys.executable)
    for name in ("python", "python3"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    # Common Windows global install locations
    candidates += [
        r"C:\Program Files\Python310\python.exe",
        r"C:\Program Files\Python311\python.exe",
        r"C:\Program Files\Python312\python.exe",
    ]

    seen: set[str] = set()
    for py in candidates:
        if not py or py in seen:
            continue
        seen.add(py)
        try:
            r = subprocess.run(
                [py, "-c", "import cv2, ultralytics"],
                capture_output=True, timeout=30,
            )
            print(f"Candidate: {py} -> exit code {r.returncode}")
            if r.returncode == 0:
                return py
        except Exception as e:
            print(f"Candidate: {py} -> failed with {e}")
            continue
    return sys.executable

print("Resolved python:", _resolve_python())
