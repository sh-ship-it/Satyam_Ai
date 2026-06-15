"""Karnataka State Police RBAC + ABAC.

Rank → scope + clearance mapping mirrors rank_access table in DB and the
KSP insignia chart from the task spec.

Scope (jurisdiction width):
  state    → DGP / ADGP / IGP
  range    → DIG / Range-IGP
  district → SP / Addl.SP / DySP
  station  → PI / CI / PSI / SI / ASI / HC / PC

Clearance (field-level sensitivity):
  L4 → full access including PROTECTED-crime victim PII
  L3 → operational fields; PROTECTED victim identity masked
  L2 → PII masked; aggregates + metadata visible
  L1 → read-only; all names masked, coordinates coarsened, PROTECTED narratives hidden
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

# ---------------------------------------------------------------------------
# PROTECTED crime types — PII of victims requires L4 + explicit reason
# ---------------------------------------------------------------------------
PROTECTED_CRIMES: frozenset[str] = frozenset({
    "POCSO", "POCSO RAPE", "RAPE", "MOLESTATION",
    "DOWRY DEATHS", "SC/ST (ATROCITIES)",
    "SEXUAL HARASSMENT", "STALKING",
    "ASSAULT ON WOMEN", "KIDNAPPING OF WOMEN AND GIRLS",
})


def is_protected(crime_type: str | None) -> bool:
    return (crime_type or "").upper() in PROTECTED_CRIMES


# ---------------------------------------------------------------------------
# Rank → scope + clearance
# ---------------------------------------------------------------------------
RANK_SCOPE: dict[str, str] = {
    # Gazetted — state/range/district
    "DGP":     "state",    "ADGP":    "state",    "IGP":    "state",
    "DIG":     "range",
    "SP":      "district", "Addl.SP": "district",
    "DySP":    "district",
    # Non-gazetted — station (or circle for PI/CI but we map to station for simplicity)
    "CPI":     "station",  "PI":      "station",  "CI":    "station",
    "PSI":     "station",  "SI":      "station",
    "ASI":     "station",
    "HC":      "station",  "PC":      "station",
    # App-level roles (for demo)
    "admin":   "state",    "analyst": "state",    "investigator": "district",
    "viewer":  "station",
}

RANK_CLEARANCE: dict[str, int] = {
    "DGP": 4, "ADGP": 4, "IGP": 4,
    "DIG": 4,
    "SP":  4, "Addl.SP": 4,
    "DySP": 3,
    "CPI": 3, "PI": 3, "CI": 3,
    "PSI": 2, "SI": 2,
    "ASI": 2,
    "HC":  1, "PC": 1,
    # App roles
    "admin": 4, "analyst": 3, "investigator": 2, "viewer": 1,
}


def resolve_scope(rank: str) -> str:
    return RANK_SCOPE.get(rank, "station")


def resolve_clearance(rank: str) -> int:
    return RANK_CLEARANCE.get(rank, 1)


# ---------------------------------------------------------------------------
# Permission enum
# ---------------------------------------------------------------------------
class Permission(str, Enum):
    CHAT           = "chat"
    READ_CASE      = "read_case"
    READ_SENSITIVE = "read_sensitive"   # clearance L3+
    READ_PROTECTED = "read_protected"   # clearance L4, PROTECTED crimes
    RUN_ANALYTICS  = "run_analytics"
    BUILD_REPORT   = "build_report"
    READ_AUDIT     = "read_audit"
    ADMIN          = "admin"


# Minimum clearance per permission
_PERM_CLEARANCE: dict[Permission, int] = {
    Permission.CHAT:           1,
    Permission.READ_CASE:      1,
    Permission.READ_SENSITIVE: 3,
    Permission.READ_PROTECTED: 4,
    Permission.RUN_ANALYTICS:  2,
    Permission.BUILD_REPORT:   2,
    Permission.READ_AUDIT:     3,
    Permission.ADMIN:          4,
}


# ---------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Principal:
    id: str
    name: str
    rank: str                      # canonical KSP rank string
    scope: str                     # state | range | district | station
    clearance: int                 # 1–4
    officer_id: int | None = None
    station_id: int | None = None
    district: str = ""
    range_name: str = ""

    # Convenience wrappers (keep old callers working)
    @property
    def role(self) -> str:
        return self.rank

    @property
    def jurisdiction_id(self) -> str | None:
        """Legacy: return district as jurisdiction string."""
        return self.district or None

    def has(self, perm: Permission) -> bool:
        needed = _PERM_CLEARANCE.get(perm, 4)
        return self.clearance >= needed

    def can_view_case_full(self, crime_type: str | None) -> bool:
        """Can this principal see unmasked PII for a given crime type?"""
        if is_protected(crime_type):
            return self.clearance >= 4
        return self.clearance >= 3

    def should_mask_pii(self, crime_type: str | None) -> bool:
        return not self.can_view_case_full(crime_type)

    def should_coarsen_coords(self) -> bool:
        return self.clearance < 2

    def can_see_narrative(self, crime_type: str | None) -> bool:
        if is_protected(crime_type):
            return self.clearance >= 3
        return True


class AccessDenied(Exception):
    pass


def require(principal: Principal, perm: Permission) -> None:
    if not principal.has(perm):
        raise AccessDenied(
            f"rank {principal.rank!r} (clearance L{principal.clearance}) "
            f"lacks permission: {perm.value}"
        )
