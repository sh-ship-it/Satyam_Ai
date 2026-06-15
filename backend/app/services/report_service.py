"""Report builder. Produces a structured (JSON) report payload; the PDF export
can be rendered with WeasyPrint/Chromium downstream (see spec deployment).
"""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rbac import Principal
from app.schemas.report import ReportRequest, ReportResponse
from app.services import case_service


async def build(
    session: AsyncSession, principal: Principal, req: ReportRequest
) -> ReportResponse:
    sections: list[dict] = [
        {"type": "header", "title": req.title,
         "prepared_by": principal.name, "role": principal.rank}
    ]
    for fir in req.case_ids:
        try:
            case = await case_service.get_case(session, principal, int(fir))
        except (ValueError, TypeError):
            continue
        if case:
            sections.append({"type": "case", "data": case})
    if req.include_map:
        sections.append({"type": "map", "note": "hotspot snapshot attached"})
    if req.include_network:
        sections.append({"type": "network", "note": "link chart attached"})
    sections.append({"type": "footer",
                     "disclaimer": "Synthetic data. Human review required."})
    return ReportResponse(
        report_id=uuid.uuid4().hex,
        title=req.title,
        sections=sections,
        generated_at=dt.datetime.now(dt.timezone.utc).isoformat(),
    )
