"""Conversation slot-filling state, persisted in Redis (falls back to memory)."""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict, dataclass, field

from app.config import get_settings


@dataclass
class ConversationState:
    conversation_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    turns: list[dict] = field(default_factory=list)
    slots: dict = field(default_factory=dict)
    updated_at: float = field(default_factory=time.time)

    def add_turn(self, role: str, text: str) -> None:
        self.turns.append({"role": role, "text": text})
        self.turns = self.turns[-12:]  # bounded context window
        self.updated_at = time.time()

    def merge_slots(self, new: dict | None) -> None:
        for k, v in (new or {}).items():
            if v:
                self.slots[k] = v


class _MemoryStore(dict):
    pass


_memory: _MemoryStore = _MemoryStore()


class ConversationStore:
    """Thin store; uses Redis if reachable, else process memory (demo/tests)."""

    def __init__(self) -> None:
        self._redis = None
        try:
            import redis.asyncio as redis  # type: ignore

            self._redis = redis.from_url(get_settings().redis_url, decode_responses=True)
        except Exception:
            self._redis = None

    @staticmethod
    def _key(owner_id: str, conversation_id: str) -> str:
        # Namespacing by owner_id prevents a user from loading (or resuming)
        # another user's conversation by guessing/replaying a conversation_id.
        return f"conv:{owner_id}:{conversation_id}"

    async def load(
        self, conversation_id: str | None, *, owner_id: str
    ) -> ConversationState:
        if not conversation_id:
            return ConversationState()
        key = self._key(owner_id, conversation_id)
        if self._redis is not None:
            try:
                raw = await self._redis.get(key)
                if raw:
                    return ConversationState(**json.loads(raw))
            except Exception:
                pass
        raw = _memory.get(key)
        return ConversationState(**json.loads(raw)) if raw else ConversationState(
            conversation_id=conversation_id
        )

    async def save(self, state: ConversationState, *, owner_id: str) -> None:
        key = self._key(owner_id, state.conversation_id)
        raw = json.dumps(asdict(state))
        if self._redis is not None:
            try:
                await self._redis.set(key, raw, ex=86400)
                return
            except Exception:
                pass
        _memory[key] = raw
