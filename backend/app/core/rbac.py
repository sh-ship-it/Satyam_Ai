"""Role-based + attribute-based access control.

RBAC decides *what actions* a role may perform; ABAC decides *which rows* a
user may touch (jurisdiction / station / clearance vs. case sensitivity).
The row-level decisions are also enforced in Postgres via RLS (see db/rls.py);
this module is the application-side mirror used for fast checks and masking.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    INVESTIGATOR = "investigator"
    ANALYST = "analyst"
    VIEWER = "viewer"


class Permission(str, Enum):
    CHAT = "chat"
    READ_CASE = "read_case"
    READ_SENSITIVE = "read_sensitive"
    RUN_ANALYTICS = "run_analytics"
    BUILD_REPORT = "build_report"
    READ_AUDIT = "read_audit"


ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.ADMIN: set(Permission),
    Role.INVESTIGATOR: {
        Permission.CHAT, Permission.READ_CASE, Permission.READ_SENSITIVE,
        Permission.RUN_ANALYTICS, Permission.BUILD_REPORT,
    },
    Role.ANALYST: {
        Permission.CHAT, Permission.READ_CASE,
        Permission.RUN_ANALYTICS, Permission.BUILD_REPORT,
    },
    Role.VIEWER: {Permission.CHAT, Permission.READ_CASE},
}

# Minimum clearance required to view a case at a given sensitivity flag.
SENSITIVITY_MIN_CLEARANCE = {0: 1, 1: 2, 2: 3}


@dataclass(frozen=True)
class Principal:
    id: str
    name: str
    role: Role
    station_id: str | None = None
    jurisdiction_id: str | None = None
    clearance: int = 1

    def has(self, perm: Permission) -> bool:
        return perm in ROLE_PERMISSIONS.get(self.role, set())

    def can_view_sensitivity(self, sensitivity_flag: int) -> bool:
        if self.role is Role.ADMIN:
            return True
        needed = SENSITIVITY_MIN_CLEARANCE.get(sensitivity_flag, 99)
        if self.clearance < needed:
            return False
        if sensitivity_flag >= 1 and not self.has(Permission.READ_SENSITIVE):
            return False
        return True

    def can_access_jurisdiction(self, jurisdiction_id: str | None) -> bool:
        if self.role in (Role.ADMIN, Role.ANALYST):
            return True  # analysts get cross-jurisdiction aggregate access
        if self.jurisdiction_id is None:
            return True
        return jurisdiction_id == self.jurisdiction_id


class AccessDenied(Exception):
    pass


def require(principal: Principal, perm: Permission) -> None:
    if not principal.has(perm):
        raise AccessDenied(f"{principal.role} lacks permission: {perm.value}")
