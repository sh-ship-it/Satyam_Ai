from app.core.rbac import Permission, Principal, Role


def test_viewer_cannot_run_analytics():
    p = Principal(id="v", name="V", role=Role.VIEWER, clearance=1)
    assert not p.has(Permission.RUN_ANALYTICS)
    assert p.has(Permission.READ_CASE)


def test_clearance_gates_sensitivity():
    inv = Principal(id="i", name="I", role=Role.INVESTIGATOR, clearance=2)
    assert inv.can_view_sensitivity(0)
    assert inv.can_view_sensitivity(1)
    assert not inv.can_view_sensitivity(2)


def test_admin_sees_everything():
    a = Principal(id="a", name="A", role=Role.ADMIN, clearance=1)
    assert a.can_view_sensitivity(2)
    assert a.has(Permission.READ_AUDIT)
