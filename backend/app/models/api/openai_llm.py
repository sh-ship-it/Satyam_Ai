"""OpenAI (ChatGPT) brain adapter.

Mirrors the GroqLLM shape so it satisfies the LLM protocol exactly.
Runs in demo mode (deterministic echo) when OPENAI_API_KEY is unset.
"""
from __future__ import annotations

from typing import AsyncIterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings


class OpenAILLM:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.openai_api_key
        self._model = s.openai_model
        self._base = s.openai_base_url.rstrip("/")
        self._demo = not self._key

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=4), reraise=True)
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
        messages = (
            [{"role": "system", "content": system}] if system else []
        ) + [{"role": "user", "content": prompt}]
        body: dict = {
            "model":       self._model,
            "messages":    messages,
            "temperature": temperature,
        }
        if json_schema:
            # json_object mode is the safe, widely-supported fallback for
            # structured output. Callers (schema + zod) re-validate the result.
            body["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{self._base}/chat/completions",
                headers={"Authorization": f"Bearer {self._key}"},
                json=body,
            )
            r.raise_for_status()
            data = r.json()
        return data["choices"][0]["message"]["content"]

    async def stream(
        self, prompt: str, *, system: str | None = None, temperature: float = 0.0
    ) -> AsyncIterator[str]:
        text = await self.complete(prompt, system=system, temperature=temperature)
        for word in text.split(" "):
            yield word + " "
