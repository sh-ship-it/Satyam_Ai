"""Investigation Board ORM models — isolated from synthetic dataset."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.models import Base


class Board(Base):
    __tablename__ = "boards"

    board_id:      Mapped[int]          = mapped_column(Integer, primary_key=True)
    owner_user_id: Mapped[int | None]   = mapped_column(
        ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    title:         Mapped[str]          = mapped_column(Text, default="Untitled board")
    district:      Mapped[str | None]   = mapped_column(Text)
    state_json:    Mapped[dict]         = mapped_column(JSONB, default=dict)
    thumbnail:     Mapped[str | None]   = mapped_column(Text)
    created_at:    Mapped[dt.datetime]  = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at:    Mapped[dt.datetime]  = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    snapshots: Mapped[list["BoardSnapshot"]] = relationship(
        back_populates="board", cascade="all, delete-orphan"
    )


class BoardSnapshot(Base):
    __tablename__ = "board_snapshots"

    snapshot_id: Mapped[int]          = mapped_column(Integer, primary_key=True)
    board_id:    Mapped[int]          = mapped_column(
        ForeignKey("boards.board_id", ondelete="CASCADE")
    )
    state_json:  Mapped[dict]         = mapped_column(JSONB)
    note:        Mapped[str | None]   = mapped_column(Text)
    created_at:  Mapped[dt.datetime]  = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    board: Mapped["Board"] = relationship(back_populates="snapshots")
