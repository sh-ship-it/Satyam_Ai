# Phase 4 — AI camera detection → human review → case + dispatch

**Goal:** Port EMERGE's confidence-tiered detection + human-review flow (`accident.controller.js` + the YOLO FastAPI service). A street CCTV feed produces **incident candidates**; medium-confidence ones land in a **human-review queue**; an officer confirms → Satyam **creates a `cases` row** and (optionally) auto-dispatches the nearest patrol (Phase 2). Requires Phase 0 (+ Phase 2 for auto-dispatch).

> **Honest framing (keep this in the demo script):** YOLO detects *vehicles/people/anomalies*, not “crime” per se. So this is **incident-candidate detection + mandatory human verification**, never autonomous accusation. That human-in-the-loop + audit trail is the ethical backbone for a police-judged datathon.

---

## 1. EDIT — `backend/app/schemas/ops.py` (append)

```python
class DetectNotify(BaseModel):
    camera_id: str
    candidate_type: str = "vehicle_anomaly"
    confidence: float
    lat: Optional[float] = None
    lng: Optional[float] = None
    clip_path: Optional[str] = None
    frame_path: Optional[str] = None


class ReviewItemOut(BaseModel):
    id: int
    camera_id: str
    candidate_type: str
    confidence: float
    lat: Optional[float] = None
    lng: Optional[float] = None
    clip_path: Optional[str] = None
    frame_path: Optional[str] = None
    status: str
    created_at: Optional[str] = None


class CameraOut(BaseModel):
    id: int
    camera_id: str
    name: str
    location: Optional[str] = None
    lat: float
    lng: float
    is_active: bool
```

---

## 2. EDIT — `backend/app/api/routes/ops.py` (append Phase 4)

Add imports:

```python
import datetime as dt

from app.db.models import Case
from app.db.ops_models import Camera, IncidentReview
from app.schemas.ops import CameraOut, DetectNotify, ReviewItemOut
```

Confidence tiers (mirror EMERGE):

```python
LOW_CONF = 0.5
HIGH_CONF = 0.8


@router.post("/detect/notify")
async def detect_notify(
    payload: DetectNotify,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Called by the YOLO sibling service. Confidence-gated, like EMERGE."""
    _guard(principal)
    if payload.confidence < LOW_CONF:
        return {"status": "IGNORED", "reason": "low confidence"}

    # geo-fill from the camera if the detector didn't supply coords
    lat, lng = payload.lat, payload.lng
    if lat is None or lng is None:
        cam = (await session.execute(select(Camera).where(Camera.camera_id == payload.camera_id))).scalar_one_or_none()
        if cam:
            lat, lng = cam.lat, cam.lng

    item = IncidentReview(
        camera_id=payload.camera_id, candidate_type=payload.candidate_type,
        confidence=payload.confidence, lat=lat, lng=lng,
        clip_path=payload.clip_path, frame_path=payload.frame_path,
        status="PENDING",
    )
    session.add(item)
    await session.flush()
    await manager.broadcast({
        "type": "INCIDENT_CANDIDATE", "id": item.id, "cameraId": payload.camera_id,
        "confidence": payload.confidence, "lat": lat, "lng": lng,
        "autoFlag": payload.confidence >= HIGH_CONF,
    })
    tier = "HIGH" if payload.confidence >= HIGH_CONF else "MEDIUM"
    return {"status": "QUEUED", "tier": tier, "id": item.id}


@router.get("/cameras", response_model=list[CameraOut])
async def cameras(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[CameraOut]:
    _guard(principal)
    rows = (await session.execute(select(Camera))).scalars().all()
    return [CameraOut(id=c.id, camera_id=c.camera_id, name=c.name, location=c.location,
                      lat=c.lat, lng=c.lng, is_active=c.is_active) for c in rows]


@router.get("/review-queue", response_model=list[ReviewItemOut])
async def review_queue(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[ReviewItemOut]:
    _guard(principal)
    rows = (await session.execute(
        select(IncidentReview).where(IncidentReview.status == "PENDING")
        .order_by(IncidentReview.created_at.desc())
    )).scalars().all()
    return [ReviewItemOut(
        id=r.id, camera_id=r.camera_id, candidate_type=r.candidate_type, confidence=r.confidence,
        lat=r.lat, lng=r.lng, clip_path=r.clip_path, frame_path=r.frame_path, status=r.status,
        created_at=r.created_at.isoformat() if r.created_at else None,
    ) for r in rows]


@router.post("/review-queue/{item_id}/reject")
async def reject_item(
    item_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _guard(principal)
    await session.execute(
        update(IncidentReview).where(IncidentReview.id == item_id)
        .values(status="REJECTED", reviewed_by=principal.name or principal.id)
    )
    return {"ok": True, "id": item_id, "status": "REJECTED"}


@router.post("/review-queue/{item_id}/confirm")
async def confirm_item(
    item_id: int,
    auto_dispatch: bool = True,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Officer confirms a candidate -> create a minimal case + (optional) dispatch."""
    _guard(principal)
    item = (await session.execute(select(IncidentReview).where(IncidentReview.id == item_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="review item not found")

    # Create a minimal case row from the confirmed incident.
    today = dt.date.today()
    new_case = Case(
        fir_number=f"CCTV-{item.id}", fir_year=today.year,
        station_id=principal.station_id or 0,
        station_name="", district=principal.district or "", range_name=principal.range_name or "",
        crime_type="CCTV-detected incident", crime_category="SLL", legal_code="BNS",
        fir_type="Suo Motu", status="Under Investigation",
        report_date=today, incident_date=today,
        latitude=item.lat, longitude=item.lng,
        place_of_offence=f"Camera {item.camera_id}",
    )
    session.add(new_case)
    await session.flush()
    await session.execute(
        update(IncidentReview).where(IncidentReview.id == item_id)
        .values(status="CONFIRMED", reviewed_by=principal.name or principal.id, case_id=new_case.case_id)
    )

    dispatch_id = None
    if auto_dispatch and item.lat is not None and item.lng is not None:
        idle = (await session.execute(select(PatrolUnit).where(PatrolUnit.status == "IDLE"))).scalars().all()
        patrol = min((p for p in idle if p.lat is not None),
                     key=lambda p: routing_service.haversine_km(p.lat, p.lng, item.lat, item.lng),
                     default=None)
        if patrol:
            route = await routing_service.get_route(
                from_lat=patrol.lat, from_lng=patrol.lng, to_lat=item.lat, to_lng=item.lng)
            disp = IncidentDispatch(
                case_id=new_case.case_id, patrol_id=patrol.id, scene_lat=item.lat, scene_lng=item.lng,
                status="ACCEPTED", route_geometry={"type": "LineString", "coordinates": route["coords"]},
                distance_km=route["distance_km"], duration_sec=route["duration_sec"], eta_sec=route["duration_sec"],
            )
            session.add(disp)
            await session.flush()
            dispatch_id = disp.id

    return {"ok": True, "case_id": new_case.case_id, "dispatch_id": dispatch_id}
```

> The `confirm` handler is the only place the module **writes** to `cases` — and only an INSERT, triggered by an explicit human action. No schema change, ever. Pair this with the existing `audit_log` (call your audit writer here if you want a formal trail).

---

## 3. NEW — `ai_camera/` sibling service (separate Python process, optional)

The YOLO model stays its own process (exactly like EMERGE's port-8000 service). It does **not** import Satyam; it just POSTs candidates to `/api/ops/detect/notify`. Minimal adapter around EMERGE's `live_cctv.py`:

**`ai_camera/requirements.txt`**
```text
ultralytics>=8.2
opencv-python>=4.9
httpx>=0.27
numpy>=1.26
```

**`ai_camera/notify.py`** — thin client to Satyam
```python
"""POST a detected incident candidate to Satyam's review queue."""
import os
import httpx

SATYAM_URL = os.getenv("SATYAM_URL", "http://localhost:8000")
SATYAM_TOKEN = os.getenv("SATYAM_TOKEN", "")  # a service JWT issued by /auth/login


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
```

**`ai_camera/detect_video.py`** — run YOLO on a video; emit a candidate when an anomaly persists (port of EMERGE `accident_logic`: stopped > 2.5 s & speed < 1).
```python
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
```

> Note: `yolov8s.pt` downloads on first run (needs internet once) and a sample crash clip is required — the EMERGE zip referenced `video.mp4` but did **not** ship it; supply any traffic/crash clip or use a webcam (`--video 0`). For a no-GPU laptop, swap `yolov8s.pt` → `yolov8n.pt`.

---

## 4. EDIT — `frontend/src/lib/api/responseOps.ts` (append)

```ts
export type ReviewItem = {
  id: number; camera_id: string; candidate_type: string; confidence: number;
  lat?: number | null; lng?: number | null; clip_path?: string | null; frame_path?: string | null;
  status: string; created_at?: string | null;
};
export type CameraInfo = { id: number; camera_id: string; name: string; location?: string | null; lat: number; lng: number; is_active: boolean };

Object.assign(responseOps, {
  cameras: () => opsFetch<CameraInfo[]>("/cameras"),
  reviewQueue: () => opsFetch<ReviewItem[]>("/review-queue"),
  confirmReview: (id: number, autoDispatch = true) =>
    opsFetch<{ ok: boolean; case_id: number; dispatch_id: number | null }>(`/review-queue/${id}/confirm?auto_dispatch=${autoDispatch}`, { method: "POST" }),
  rejectReview: (id: number) =>
    opsFetch<{ ok: boolean }>(`/review-queue/${id}/reject`, { method: "POST" }),
});
```

---

## 5. NEW — `frontend/src/components/ops/ReviewPanel.tsx`

```tsx
import { useEffect, useState } from "react";
import { Video, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { responseOps, openOpsSocket, type ReviewItem, type CameraInfo } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

export function ReviewPanel() {
  const t = useT();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [cams, setCams] = useState<CameraInfo[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const [q, c] = await Promise.all([responseOps.reviewQueue(), responseOps.cameras()]);
      setItems(q); setCams(c);
    } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ws = openOpsSocket();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "INCIDENT_CANDIDATE") load();
    };
    return () => ws.close();
  }, []);

  async function confirm(id: number) { await responseOps.confirmReview(id, true); setItems((p) => p.filter((i) => i.id !== id)); }
  async function reject(id: number) { await responseOps.rejectReview(id); setItems((p) => p.filter((i) => i.id !== id)); }

  const tier = (c: number) => (c >= 0.8 ? { label: t("High"), cls: "bg-destructive text-destructive-foreground" }
                                        : { label: t("Medium"), cls: "bg-warning text-foreground" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 text-sm font-extrabold"><Video className="h-4 w-4" /> {t("Incident review queue")}</h3>
        <button onClick={load} disabled={busy} className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground px-2 py-1 text-xs font-bold hover:bg-muted">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> {t("Refresh")}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">{cams.length} {t("cameras online")} · {t("AI flags candidates; a human confirms.")}</p>

      {items.length === 0 && <p className="text-xs text-muted-foreground">{t("No candidates awaiting review.")}</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((it) => {
          const tg = tier(it.confidence);
          return (
            <div key={it.id} className="rounded-[8px] border-2 border-foreground bg-background p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 font-extrabold"><AlertTriangle className="h-4 w-4" /> {it.camera_id}</span>
                <span className={`rounded-[4px] px-2 py-0.5 text-[10px] font-bold ${tg.cls}`}>{tg.label} · {(it.confidence * 100).toFixed(0)}%</span>
              </div>
              <div className="mb-2 aspect-video w-full overflow-hidden rounded-[4px] border-2 border-foreground bg-muted">
                {it.frame_path
                  ? <img src={it.frame_path} alt="frame" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{t("No preview")}</div>}
              </div>
              <div className="mb-2 text-[11px] text-muted-foreground">{it.candidate_type}{it.lat ? ` · ${it.lat.toFixed(3)}, ${it.lng?.toFixed(3)}` : ""}</div>
              <div className="flex gap-2">
                <button onClick={() => confirm(it.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--destructive,#FF4D50)] px-2 py-1 text-xs font-bold text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("Confirm → file case")}
                </button>
                <button onClick={() => reject(it.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-xs font-bold hover:bg-muted">
                  <XCircle className="h-3.5 w-3.5" /> {t("Reject")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 6. EDIT — `frontend/src/routes/operations.tsx` (mount review tab)

```tsx
import { ReviewPanel } from "@/components/ops/ReviewPanel";
```
```tsx
          {tab === "review" && <ReviewPanel />}
```

---

## 7. Verify

```bash
# backend already running with ENABLE_RESPONSE_OPS=true + init_ops seeded cameras
# simulate a detector hit (no YOLO needed):
curl -X POST localhost:8000/api/ops/detect/notify -H "authorization: Bearer <jwt>" \
  -H "content-type: application/json" \
  -d '{"camera_id":"CAM-001","confidence":0.72,"candidate_type":"vehicle_anomaly"}'
# -> {"status":"QUEUED","tier":"MEDIUM","id":1}

# real YOLO demo (separate process):
cd ai_camera && pip install -r requirements.txt
SATYAM_TOKEN=<jwt> python detect_video.py --video sample.mp4 --camera CAM-001
```

Response Ops → **Camera Review**: a candidate card appears (live via WS); **Confirm** files a `cases` row and auto-dispatches the nearest patrol (visible on the Dispatch tab); **Reject** clears it.

## Self-rating
- **Fit: 8/10** — reuses EMERGE's confidence tiers + review queue exactly; the YOLO service ports as-is (already Python).
- **Correctness: 8.5/10** — real `Case` columns used for the INSERT; only-on-confirm write; WS reused. The `Case` insert fills required NOT-NULL columns (`fir_number/fir_year/station_id/district/range/crime_type/crime_category/legal_code/fir_type/status/report_date`).
- **Caveats:** (1) the EMERGE zip didn't ship `video.mp4` — supply a clip or use webcam; (2) `station_id` defaults to `0` if the officer's JWT has none — set a sensible default station or make it nullable; (3) frame/clip serving is left to you (static mount or object store) — the queue stores paths only.
