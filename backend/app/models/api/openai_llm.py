"""OpenAI (ChatGPT) brain adapter.

Mirrors the GroqLLM shape so it satisfies the LLM protocol exactly.
Runs in demo mode (deterministic echo) when OPENAI_API_KEY is unset.

TWO THINGS THIS ADAPTER OWNS THAT THE OTHERS DO NOT
1. It reserves a unit of the daily budget BEFORE every real request, so the
   50/day cap cannot be bypassed by a call site that forgot to go through
   `registry.complete_with_brain`. Metering at the adapter rather than at each
   caller is what makes the cap an actual cap — `board_brain.py` and
   `screen_agent.py` both reach the brain through `get_llm()` and neither knows
   about budgets.
2. It does NOT retry quota errors. The previous `stop_after_attempt(2)` retried
   every exception, including a 429 for `insufficient_quota`, which spent a
   second reserved unit proving a request that can never succeed.
"""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator

import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import get_settings
from app.models.quota import QuotaExhausted, is_quota_error, openai_quota

log = logging.getLogger(__name__)


def _is_retryable(exc: BaseException) -> bool:
    """Retry transient transport faults only, never a spent quota."""
    return not is_quota_error(exc)


class OpenAILLM:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.openai_api_key
        self._model = s.openai_model
        self._base = s.openai_base_url.rstrip("/")
        self._demo = not self._key

    def _messages(self, prompt: str, system: str | None) -> list[dict]:
        return ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": prompt}
        ]

    async def _reserve(self) -> None:
        """Claim a unit of today's budget, or refuse before spending anything."""
        if not await openai_quota.try_reserve():
            raise QuotaExhausted(
                f"OpenAI daily budget of {openai_quota.limit} requests is spent"
            )

    @retry(
        retry=retry_if_exception(_is_retryable),
        stop=stop_after_attempt(2),
        wait=wait_exponential(min=1, max=4),
        reraise=True,
    )
    async def complete(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float = 0.0,
        json_schema: dict | None = None,
    ) -> str:
        if self._demo:
            return f"[demo:openai] {prompt[:240]}"
        # Reserved inside the retry body on purpose: a retried transport fault is
        # a second real request to OpenAI and must cost a second unit.
        await self._reserve()
        body: dict = {
            "model": self._model,
            "messages": self._messages(prompt, system),
            "temperature": temperature,
        }
        if json_schema:
            # json_object mode is the safe, widely-supported fallback for
            # structured output. Callers (schema + zod) re-validate the result.
            body["response_format"] = {"type": "json_object"}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    f"{self._base}/chat/completions",
                    headers={"Authorization": f"Bearer {self._key}"},
                    json=body,
                )
                r.raise_for_status()
                data = r.json()
        except Exception as exc:  # noqa: BLE001
            if is_quota_error(exc):
                await openai_quota.mark_exhausted()
                log.warning("openai.quota_exhausted marking rest of UTC day as spent")
            raise
        return data["choices"][0]["message"]["content"]

    async def stream(
        self, prompt: str, *, system: str | None = None, temperature: float = 0.0
    ) -> AsyncIterator[str]:
        """Real token streaming via `stream: true` on /chat/completions.

        Degrades to `complete()` on any streaming failure, so a proxy or model
        that rejects SSE still answers. The fallback does NOT double-charge: the
        reservation happens once per attempt, and a failed stream that produced no
        tokens has already consumed its unit (see the ponytail note in quota.py).
        """
        if self._demo:
            for word in f"[demo:openai] {prompt[:240]}".split(" "):
                yield word + " "
            return

        await self._reserve()
        body = {
            "model": self._model,
            "messages": self._messages(prompt, system),
            "temperature": temperature,
            "stream": True,
        }
        got_any = False
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                async with client.stream(
                    "POST",
                    f"{self._base}/chat/completions",
                    headers={"Authorization": f"Bearer {self._key}"},
                    json=body,
                ) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            delta = json.loads(payload)["choices"][0].get("delta", {})
                        except Exception:  # noqa: BLE001  (skip a malformed frame)
                            continue
                        piece = delta.get("content") or ""
                        if piece:
                            got_any = True
                            yield piece
        except Exception as exc:  # noqa: BLE001
            if is_quota_error(exc):
                await openai_quota.mark_exhausted()
                log.warning("openai.quota_exhausted (stream) marking day as spent")
                raise
            if got_any:
                # Mid-stream failure: the caller already has partial text, and
                # replaying from the start would duplicate it.
                log.warning("openai.stream_broke_midway err=%s", exc)
                raise
            log.warning("openai.stream_unavailable err=%s - using complete()", exc)
            yield await self.complete(prompt, system=system, temperature=temperature)
