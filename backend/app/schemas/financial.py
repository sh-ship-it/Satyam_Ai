"""PS7 — Financial money-trail schemas.

All data is synthetic and produced for investigative leads only; it is never
proof of guilt. Sensitive (clearance >= 2), audit-logged at the route layer.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, model_validator


class MoneyTrailRequest(BaseModel):
    # Seed the trail by a person (id or name), or by a case id.
    person_id: Optional[str] = None
    entity_name: Optional[str] = None
    case_id: Optional[int] = None
    min_amount: float = 0.0
    suspicious_only: bool = False
    depth: int = 2  # account hops to expand (clamped 1..3)

    @model_validator(mode="after")
    def _require_seed(self) -> "MoneyTrailRequest":
        if not self.person_id and not self.entity_name and self.case_id is None:
            raise ValueError("Supply person_id, entity_name, or case_id")
        if not self.person_id and self.entity_name:
            self.person_id = self.entity_name
        return self


class MoneyNode(BaseModel):
    id: str                       # "acct:<account_id>"
    label: str                    # masked account ref + bank
    kind: str = "account"
    person_id: Optional[int] = None
    person_label: Optional[str] = None
    bank_name: Optional[str] = None
    account_type: Optional[str] = None
    district: Optional[str] = None
    kyc_risk_level: Optional[str] = None
    total_in: float = 0.0
    total_out: float = 0.0
    degree: int = 0
    is_seed: bool = False


class MoneyEdge(BaseModel):
    source: str                   # "acct:<from_account_id>"
    target: str                   # "acct:<to_account_id>"
    amount: float
    txn_count: int = 1
    channel: Optional[str] = None
    pattern_flag: Optional[str] = None
    is_suspicious: bool = False
    case_id: Optional[int] = None


class MoneyTrailResponse(BaseModel):
    seed: str
    nodes: list[MoneyNode] = []
    edges: list[MoneyEdge] = []
    flagged_count: int = 0
    total_amount: float = 0.0
    notice: str = (
        "Synthetic financial leads - investigative use only, not proof of guilt."
    )
