"""Response-Ops router. Mounted at /api/ops only when ENABLE_RESPONSE_OPS=true."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
import datetime as dt
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_principal, get_scoped_session
from app.core.rbac import AccessDenied, Permission, Principal, require, resolve_clearance, resolve_scope
from app.core.security import decode_token
from app.db.models import Case, Station
from app.db.ops_models import Camera, IncidentDispatch, IncidentReview, PatrolSuggestion, PatrolUnit, RiskZone, TrafficSignal
from app.schemas.ops import (
    CameraOut, DetectNotify, ReviewItemOut,
    DispatchOut, DispatchRequest, PatrolOut,
    RiskZoneOut, RiskZonesResponse, SuggestionOut, SuggestionsResponse,
)
from app.services.ops import corridor_service, risk_service, routing_service, sim_service
from app.services.ops.ws_manager import manager

router = APIRouter()


def _guard(principal: Principal) -> None:
    pass  # all authenticated officers can access Response Ops


@router.get("/health")
async def ops_health(principal: Principal = Depends(get_principal)) -> dict:
    """Cheap liveness probe for the Response-Ops module."""
    return {"ok": True, "module": "response-ops", "rank": principal.rank}


@router.get("/risk-zones", response_model=RiskZonesResponse)
async def risk_zones(
    refresh: bool = False,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> RiskZonesResponse:
    _guard(principal)
    recomputed = await risk_service.recompute_if_stale(session, force=refresh)
    zones = (await session.execute(
        select(RiskZone).order_by(RiskZone.risk_score.desc())
    )).scalars().all()
    return RiskZonesResponse(
        zones=[RiskZoneOut(
            id=z.id, grid_key=z.grid_key, center_lat=z.center_lat, center_lng=z.center_lng,
            risk_score=z.risk_score, risk_label=z.risk_label, incident_count=z.incident_count,
            peak_hour=z.peak_hour, reasons=z.reasons or [],
        ) for z in zones],
        recomputed=recomputed, total=len(zones),
    )


@router.get("/suggestions", response_model=SuggestionsResponse)
async def suggestions(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> SuggestionsResponse:
    _guard(principal)
    rows = (await session.execute(
        select(PatrolSuggestion, PatrolUnit.callsign)
        .join(PatrolUnit, PatrolUnit.id == PatrolSuggestion.patrol_id, isouter=True)
        .where(PatrolSuggestion.status == "PENDING")
        .order_by(PatrolSuggestion.response_improve_sec.is_(None),
                  PatrolSuggestion.response_improve_sec.desc())
    )).all()
    return SuggestionsResponse(
        suggestions=[SuggestionOut(
            id=s.id, risk_zone_id=s.risk_zone_id, patrol_id=s.patrol_id, patrol_callsign=cs,
            from_lat=s.from_lat, from_lng=s.from_lng, to_lat=s.to_lat, to_lng=s.to_lng,
            distance_km=s.distance_km, response_improve_sec=s.response_improve_sec,
            status=s.status, reasons=s.reasons or [],
        ) for s, cs in rows],
        total=len(rows),
    )


@router.post("/suggestions/{sug_id}/{action}")
async def act_on_suggestion(
    sug_id: int, action: str,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _guard(principal)
    if action not in ("accept", "dismiss"):
        raise HTTPException(status_code=400, detail="action must be accept|dismiss")
    new_status = "ACCEPTED" if action == "accept" else "DISMISSED"
    await session.execute(
        update(PatrolSuggestion).where(PatrolSuggestion.id == sug_id).values(status=new_status)
    )
    # Accepting pre-positions the patrol (status stays IDLE, just relocates on the map).
    if action == "accept":
        sug = (await session.execute(
            select(PatrolSuggestion).where(PatrolSuggestion.id == sug_id)
        )).scalar_one_or_none()
        if sug and sug.patrol_id:
            await session.execute(
                update(PatrolUnit).where(PatrolUnit.id == sug.patrol_id)
                .values(lat=sug.to_lat, lng=sug.to_lng)
            )
    return {"ok": True, "id": sug_id, "status": new_status}


@router.get("/patrols", response_model=list[PatrolOut])
async def patrols(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[PatrolOut]:
    _guard(principal)
    rows = (await session.execute(select(PatrolUnit))).scalars().all()
    return [PatrolOut(id=p.id, callsign=p.callsign, status=p.status, lat=p.lat, lng=p.lng, district=p.district) for p in rows]


@router.post("/dispatch", response_model=DispatchOut)
async def dispatch(
    req: DispatchRequest,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> DispatchOut:
    _guard(principal)
    # pick patrol
    if req.patrol_id:
        patrol = (await session.execute(select(PatrolUnit).where(PatrolUnit.id == req.patrol_id))).scalar_one_or_none()
    else:
        idle = (await session.execute(select(PatrolUnit).where(PatrolUnit.status == "IDLE"))).scalars().all()
        patrol = min(
            (p for p in idle if p.lat is not None),
            key=lambda p: routing_service.haversine_km(p.lat, p.lng, req.scene_lat, req.scene_lng),
            default=None,
        )
    if not patrol:
        raise HTTPException(status_code=409, detail="no available patrol unit")
    if patrol.lat is None or patrol.lng is None:
        raise HTTPException(status_code=409, detail="selected patrol has no location")

    route = await routing_service.get_route(
        from_lat=patrol.lat, from_lng=patrol.lng, to_lat=req.scene_lat, to_lng=req.scene_lng,
    )
    disp = IncidentDispatch(
        case_id=req.case_id, patrol_id=patrol.id, scene_lat=req.scene_lat, scene_lng=req.scene_lng,
        status="ACCEPTED", route_geometry={"type": "LineString", "coordinates": route["coords"]},
        distance_km=route["distance_km"], duration_sec=route["duration_sec"], eta_sec=route["duration_sec"],
    )
    session.add(disp)
    await session.flush()
    await session.execute(
        update(PatrolUnit).where(PatrolUnit.id == patrol.id).values(status="EN_ROUTE")
    )
    return DispatchOut(
        id=disp.id, patrol_id=patrol.id, patrol_callsign=patrol.callsign, case_id=req.case_id,
        scene_lat=req.scene_lat, scene_lng=req.scene_lng, status=disp.status,
        distance_km=route["distance_km"], duration_sec=route["duration_sec"], eta_sec=route["duration_sec"],
        route=route["coords"],
    )


@router.post("/dispatch/{dispatch_id}/simulate")
async def simulate(
    dispatch_id: int,
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    _guard(principal)
    disp = (await session.execute(select(IncidentDispatch).where(IncidentDispatch.id == dispatch_id))).scalar_one_or_none()
    if not disp or not disp.route_geometry:
        raise HTTPException(status_code=404, detail="dispatch or route not found")
    coords = disp.route_geometry["coordinates"]
    sim_service.start(
        dispatch_id, disp.patrol_id, coords, disp.duration_sec or 60,
        on_move=corridor_service.activate_near,
    )
    return {"ok": True, "dispatchId": dispatch_id, "points": len(coords)}


@router.get("/dispatch/{dispatch_id}/state")
async def dispatch_state(
    dispatch_id: int,
    principal: Principal = Depends(get_principal),
) -> dict:
    """Polling fallback for clients that can't hold a WebSocket."""
    _guard(principal)
    return sim_service.latest_state(dispatch_id) or {"status": "UNKNOWN"}


@router.get("/dispatch/active")
async def dispatch_active(
    principal: Principal = Depends(get_principal),
) -> dict:
    """Every dispatch currently mid-simulation (drives the Active Dispatches list)."""
    _guard(principal)
    return {"active": sim_service.active_states()}


@router.post("/dispatch/simulate-all")
async def simulate_all(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> dict:
    """Start a live simulation for every unfinished dispatch that has a route."""
    _guard(principal)
    rows = (await session.execute(
        select(IncidentDispatch).where(IncidentDispatch.status.not_in(["COMPLETED", "CANCELLED"]))
    )).scalars().all()
    started = 0
    for disp in rows:
        if disp.route_geometry and disp.id not in sim_service.active_ids():
            sim_service.start(
                disp.id, disp.patrol_id, disp.route_geometry["coordinates"],
                disp.duration_sec or 60, on_move=corridor_service.activate_near,
            )
            started += 1
    return {"ok": True, "started": started}


@router.post("/dispatch/stop-all")
async def stop_all(
    principal: Principal = Depends(get_principal),
) -> dict:
    """Cancel every running simulation and reset the green corridor."""
    _guard(principal)
    sim_service.stop_all()
    return {"ok": True}


@router.websocket("/ws")
async def ops_ws(ws: WebSocket, token: str | None = None) -> None:
    """Live event stream. Auth via ?token=<jwt> query param (WS can't send headers)."""
    if not token:
        await ws.close(code=4401)
        return
    try:
        claims = decode_token(token)
    except Exception:
        await ws.close(code=4401)
        return
    # Rebuild a minimal Principal so the WS handler has identity context,
    # but no clearance gate — all authenticated officers can use Response Ops.
    rank = str(claims.get("rank") or claims.get("role") or "viewer")
    principal = Principal(
        id=str(claims.get("sub", "")),
        name=str(claims.get("name", "")),
        rank=rank,
        scope=str(claims.get("scope") or resolve_scope(rank)),
        clearance=int(claims.get("clearance") or resolve_clearance(rank)),
    )
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive; client may send pings
    except WebSocketDisconnect:
        await manager.disconnect(ws)


@router.get("/signals")
async def signals(
    session: AsyncSession = Depends(get_scoped_session),
    principal: Principal = Depends(get_principal),
) -> list[dict]:
    _guard(principal)
    rows = (await session.execute(select(TrafficSignal))).scalars().all()
    return [{"id": s.id, "junction_id": s.junction_id, "lat": s.lat, "lng": s.lng, "state": s.state} for s in rows]


@router.get("/corridor/state")
async def corridor_state(principal: Principal = Depends(get_principal)) -> dict:
    """Green-corridor status for the Demo dashboard side panel."""
    _guard(principal)
    return await corridor_service.state()


@router.post("/corridor/reset")
async def corridor_reset(principal: Principal = Depends(get_principal)) -> dict:
    """Deactivate the green corridor — restore every signal to NORMAL."""
    _guard(principal)
    await corridor_service.reset_all()
    return {"ok": True}


@router.get("/demo/active")
async def demo_active(principal: Principal = Depends(get_principal)) -> dict:
    """Live snapshot of every running simulation (polling fallback for the dashboard)."""
    _guard(principal)
    return {"active": sim_service.active_states()}


@router.post("/demo/stop-all")
async def demo_stop_all(principal: Principal = Depends(get_principal)) -> dict:
    """Stop All: cancel every running simulation and clear the green corridor."""
    _guard(principal)
    ids = sim_service.active_ids()
    for did in ids:
        sim_service.stop(did)
    await corridor_service.reset_all()
    return {"stopped": len(ids)}


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
        "candidateType": payload.candidate_type,
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
    # station_id is a NOT-NULL FK -> resolve a valid station (officer's, else first seeded).
    sid = principal.station_id
    if not sid:
        sid = (await session.execute(select(Station.station_id).limit(1))).scalar()
    if not sid:
        raise HTTPException(status_code=409, detail="no station available to file case")
    sname = (await session.execute(
        select(Station.station_name).where(Station.station_id == sid)
    )).scalar() or ""
    new_case = Case(
        fir_number=f"CCTV-{item.id}", fir_year=today.year,
        station_id=sid,
        station_name=sname, district=principal.district or "", range_name=principal.range_name or "",
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
            await session.execute(
                update(PatrolUnit).where(PatrolUnit.id == patrol.id).values(status="EN_ROUTE")
            )
            dispatch_id = disp.id

    return {"ok": True, "case_id": new_case.case_id, "dispatch_id": dispatch_id}


# ── Camera YOLO process control ───────────────────────────────────────────────
import subprocess as _subprocess
import sys as _sys
import pathlib as _pathlib
import threading as _threading

_yolo_proc: "_subprocess.Popen[bytes] | None" = None
_yolo_stream_port: int = 0


def _drain(proc: "_subprocess.Popen[bytes]") -> None:
    """Read and print stdout so the pipe buffer never fills and blocks the child."""
    if proc.stdout is None:
        return
    try:
        for line in iter(proc.stdout.readline, b""):
            print("[YOLO]", line.decode("utf-8", errors="replace").rstrip(), flush=True)
    except Exception:
        pass


def _resolve_python() -> str:
    """Find a Python interpreter that has ultralytics + cv2 installed.

    The backend venv usually lacks these heavy CV deps, so we probe a few
    candidates and pick the first that can import them. Override with YOLO_PYTHON.
    """
    import os as _os
    import shutil as _shutil

    candidates: list[str] = []
    env_py = _os.getenv("YOLO_PYTHON")
    if env_py:
        candidates.append(env_py)
    candidates.append(_sys.executable)
    for name in ("python", "python3"):
        found = _shutil.which(name)
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
            r = _subprocess.run(
                [py, "-c", "import cv2, ultralytics"],
                capture_output=True, timeout=30,
            )
            if r.returncode == 0:
                return py
        except Exception:
            continue
    # Nothing found — return backend python so the error surfaces clearly.
    return _sys.executable


@router.post("/camera/start")
async def camera_start(
    video: str = "frontend/public/total fight.mp4",
    camera_id: str = "CAM-001",
    principal: Principal = Depends(get_principal),
) -> dict:
    """Launch the YOLO live_cctv detector as a background process."""
    _guard(principal)
    global _yolo_proc, _yolo_stream_port
    if _yolo_proc is not None and _yolo_proc.poll() is None:
        return {"ok": True, "status": "already_running", "pid": _yolo_proc.pid,
                "stream_port": _yolo_stream_port}

    # Locate live_cctv.py relative to this file: backend/app/api/routes/ops.py
    # parents[4] = repo root (ops.py → routes → api → app → backend → repo)
    script = _pathlib.Path(__file__).resolve().parents[4] / "model" / "inference" / "live_cctv.py"
    if not script.exists():
        script = _pathlib.Path.cwd().parent / "model" / "inference" / "live_cctv.py"
    if not script.exists():
        raise HTTPException(
            status_code=404,
            detail="YOLO script not found. Expected: model/inference/live_cctv.py relative to repo root",
        )

    # Resolve video path relative to repo root
    repo_root = script.parents[2]  # model/inference/live_cctv.py → model/inference → model → repo
    video_path = (repo_root / video) if not _pathlib.Path(video).is_absolute() else _pathlib.Path(video)
    if not video_path.exists():
        video_path = _pathlib.Path.cwd().parent / video
    if not video_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Video not found: {video}. Place your video at frontend/public/total fight.mp4",
        )

    # Build a short-lived token so the YOLO subprocess can authenticate to /detect/notify
    import os as _os
    from app.core.security import create_access_token
    _token = create_access_token(
        subject=principal.id, name=principal.name, rank=principal.rank,
        scope=principal.scope, clearance=principal.clearance,
    )

    py = _resolve_python()
    # Pick a guaranteed-free port for the MJPEG stream (avoids "address in use").
    def _free_port(preferred: int) -> int:
        import socket as _socket
        # Try the preferred port first, fall back to an OS-assigned free port.
        for cand in (preferred, 0):
            s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
            try:
                s.bind(("0.0.0.0", cand))
                port = s.getsockname()[1]
                s.close()
                return port
            except OSError:
                s.close()
                continue
        return preferred

    mjpeg_port = _free_port(int(_os.getenv("YOLO_MJPEG_PORT", "8089")))
    _yolo_stream_port = mjpeg_port
    env = {**_os.environ, "SATYAM_URL": "http://localhost:8000", "SATYAM_TOKEN": _token}
    _yolo_proc = _subprocess.Popen(
        [py, str(script), "--video", str(video_path), "--camera", camera_id,
         "--no-display", "--mjpeg-port", str(mjpeg_port)],
        cwd=str(script.parent),
        env=env,
        stdout=_subprocess.PIPE,
        stderr=_subprocess.STDOUT,
    )
    # Drain the pipe in a daemon thread — prevents the child from blocking when
    # stdout fills up (the main symptom: video freezes after ~3 s).
    _threading.Thread(target=_drain, args=(_yolo_proc,), daemon=True).start()

    # ── Wait for the MJPEG server to actually bind its port ─────────────────
    # The subprocess takes a moment to load the model and start the HTTP
    # server. Poll the port so we don't return until the stream is ready,
    # avoiding the ERR_CONNECTION_REFUSED race condition in the browser.
    import asyncio as _asyncio
    import socket as _socket

    async def _wait_for_port(port: int, timeout: float = 8.0) -> bool:
        deadline = _asyncio.get_event_loop().time() + timeout
        while _asyncio.get_event_loop().time() < deadline:
            try:
                s = _socket.create_connection(("127.0.0.1", port), timeout=0.15)
                s.close()
                return True
            except OSError:
                await _asyncio.sleep(0.2)
        return False

    await _wait_for_port(mjpeg_port)

    return {
        "ok": True, "status": "started", "pid": _yolo_proc.pid,
        "python": py, "stream_port": mjpeg_port,
    }


@router.post("/camera/stop")
async def camera_stop(
    principal: Principal = Depends(get_principal),
) -> dict:
    """Kill the running YOLO detector process."""
    _guard(principal)
    global _yolo_proc
    if _yolo_proc is None or _yolo_proc.poll() is not None:
        _yolo_proc = None
        return {"ok": True, "status": "not_running"}
    _yolo_proc.terminate()
    try:
        _yolo_proc.wait(timeout=5)
    except Exception:
        _yolo_proc.kill()
    _yolo_proc = None
    return {"ok": True, "status": "stopped"}


@router.get("/camera/status")
async def camera_status(
    principal: Principal = Depends(get_principal),
) -> dict:
    """Check whether the YOLO detector is running."""
    _guard(principal)
    global _yolo_proc
    running = _yolo_proc is not None and _yolo_proc.poll() is None
    if not running:
        _yolo_proc = None
    return {"running": running, "pid": _yolo_proc.pid if running else None,
            "stream_port": _yolo_stream_port if running else 0}
