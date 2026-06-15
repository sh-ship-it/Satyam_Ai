"""RBAC tests — updated for v2 Principal API (rank/scope/clearance)."""
from app.core.rbac import Permission, Principal, is_protected, PROTECTED_CRIMES


def _make(rank: str, scope: str, clearance: int, **kw) -> Principal:
    return Principal(id="test", name="Test", rank=rank, scope=scope, clearance=clearance, **kw)


# ── Permission gates ──────────────────────────────────────────────────────────

def test_pc_chat_only():
    p = _make("PC", "station", 1)
    assert p.has(Permission.CHAT)
    assert p.has(Permission.READ_CASE)
    assert not p.has(Permission.RUN_ANALYTICS)
    assert not p.has(Permission.READ_AUDIT)
    assert not p.has(Permission.READ_PROTECTED)
    assert not p.has(Permission.ADMIN)


def test_psi_analytics():
    p = _make("PSI", "station", 2)
    assert p.has(Permission.RUN_ANALYTICS)
    assert not p.has(Permission.READ_AUDIT)


def test_sp_full_district():
    p = _make("SP", "district", 4)
    assert p.has(Permission.READ_AUDIT)
    assert p.has(Permission.READ_PROTECTED)
    assert p.has(Permission.ADMIN)


def test_dgp_everything():
    p = _make("DGP", "state", 4)
    assert p.has(Permission.ADMIN)
    assert p.has(Permission.READ_PROTECTED)


# ── PII masking tiers ─────────────────────────────────────────────────────────

def test_l1_masks_all():
    p = _make("PC", "station", 1)
    assert p.should_mask_pii("Theft")        # L1 always masks
    assert p.should_mask_pii("RAPE")
    assert p.should_coarsen_coords()


def test_l2_masks_all():
    p = _make("PSI", "station", 2)
    assert p.should_mask_pii("Theft")        # L2 masks all PII
    assert not p.should_coarsen_coords()


def test_l3_masks_protected_only():
    p = _make("PI", "station", 3)
    assert not p.should_mask_pii("Theft")    # L3 sees non-protected names
    assert p.should_mask_pii("RAPE")         # L3 masks PROTECTED victim names


def test_l4_sees_everything():
    p = _make("SP", "district", 4)
    assert not p.should_mask_pii("Theft")
    assert not p.should_mask_pii("POCSO")    # L4 sees even PROTECTED crime PII


# ── Narrative visibility ──────────────────────────────────────────────────────

def test_l1_cannot_see_protected_narrative():
    p = _make("PC", "station", 1)
    assert not p.can_see_narrative("RAPE")
    assert p.can_see_narrative("Theft")


def test_l3_can_see_protected_narrative():
    p = _make("PI", "station", 3)
    assert p.can_see_narrative("RAPE")


# ── Protected crime detection ─────────────────────────────────────────────────

def test_protected_crimes_detected():
    for c in ("POCSO", "RAPE", "MOLESTATION", "DOWRY DEATHS"):
        assert is_protected(c), f"{c} should be PROTECTED"


def test_non_protected_crimes():
    for c in ("Theft", "Burglary", "Assault", "FRAUD", "NARCOTICS"):
        assert not is_protected(c), f"{c} should NOT be PROTECTED"


def test_case_insensitive():
    assert is_protected("pocso")
    assert is_protected("rape")
    assert not is_protected("theft")
