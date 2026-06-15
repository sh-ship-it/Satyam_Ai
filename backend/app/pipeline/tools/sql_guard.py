"""Text-to-SQL guardrail.

The LLM is never trusted to produce safe SQL. Every candidate query is parsed
with sqlglot and rejected unless it is:
  - a single statement,
  - a SELECT (no INSERT/UPDATE/DELETE/DDL/transaction control),
  - referencing only allow-listed tables,
  - free of multiple-statement / comment injection,
  - bounded by a LIMIT (auto-applied if missing).

Row scoping (jurisdiction scope) is enforced separately by Postgres RLS policies.
Column-level PII masking is applied by `text_to_sql._mask_rows()` after execution
for callers below clearance L3 — the v2 schema uses the raw `persons` table
(no `persons_v` view), so masking lives in the Python layer, not the DB.
"""
from __future__ import annotations

import sqlglot
from sqlglot import exp

ALLOWED_TABLES = {
    "cases", "persons", "case_persons", "stations", "officers", "narratives",
}
MAX_LIMIT = 200


class UnsafeSQL(Exception):
    pass


def sanitize(sql: str) -> str:
    """Validate and normalize a candidate SELECT. Raises UnsafeSQL on violation."""
    sql = (sql or "").strip().rstrip(";").strip()
    if not sql:
        raise UnsafeSQL("empty query")

    try:
        statements = sqlglot.parse(sql, read="postgres")
    except Exception as e:  # noqa: BLE001
        raise UnsafeSQL(f"unparseable: {e}") from e

    statements = [s for s in statements if s is not None]
    if len(statements) != 1:
        raise UnsafeSQL("only a single statement is allowed")

    stmt = statements[0]
    if not isinstance(stmt, exp.Select):
        raise UnsafeSQL("only SELECT statements are allowed")

    # Reject any write/DDL/CTE-into nodes anywhere in the tree.
    forbidden = (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create,
                 exp.Alter, exp.Command, exp.TruncateTable)
    if any(stmt.find(f) for f in forbidden):
        raise UnsafeSQL("write/DDL operations are not permitted")

    # Table allow-list.
    for table in stmt.find_all(exp.Table):
        if table.name.lower() not in ALLOWED_TABLES:
            raise UnsafeSQL(f"table not allowed: {table.name}")

    # Enforce a LIMIT.
    limit = stmt.args.get("limit")
    if limit is None:
        stmt = stmt.limit(MAX_LIMIT)
    else:
        try:
            if int(limit.expression.name) > MAX_LIMIT:
                stmt.set("limit", exp.Limit(expression=exp.Literal.number(MAX_LIMIT)))
        except Exception:
            stmt.set("limit", exp.Limit(expression=exp.Literal.number(MAX_LIMIT)))

    return stmt.sql(dialect="postgres")
