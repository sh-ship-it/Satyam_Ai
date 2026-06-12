import pytest

from app.pipeline.tools.sql_guard import UnsafeSQL, sanitize


def test_allows_simple_select_and_adds_limit():
    out = sanitize("SELECT fir_no, crime_type FROM cases WHERE district = 'Mysuru'")
    assert "LIMIT 200" in out.upper()
    assert out.lower().startswith("select")


def test_blocks_delete():
    with pytest.raises(UnsafeSQL):
        sanitize("DELETE FROM cases")


def test_blocks_multiple_statements():
    with pytest.raises(UnsafeSQL):
        sanitize("SELECT * FROM cases; DROP TABLE cases")


def test_blocks_unknown_table():
    with pytest.raises(UnsafeSQL):
        sanitize("SELECT * FROM secret_table")


def test_clamps_large_limit():
    out = sanitize("SELECT * FROM cases LIMIT 99999")
    assert "200" in out
