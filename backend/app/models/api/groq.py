"""Groq client — low-latency fallback lane (short prompts, TPM-limited).

Used when the primary LLM times out or returns 429. Also the preferred lane for
rephrasing sensitive narrative text (open models + Llama Guard) per the spec.
"""
from __future__ import annotations

from typing import AsyncIterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings

_URL = "https://api.groq.com/openai/v1/chat/completions"


class GroqLLM:
    def __init__(self) -> None:
        s = get_settings()
        self._key = s.groq_api_key
        self._model = s.groq_model
        self._demo = not self._key

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=4), reraise=True)
    async def complete(self, prompt: str, *, system: str | None = None,
                       temperature: float = 0.0, json_schema: dict | None = None) -> str:
        if self._demo:
            return f"[demo:groq] {prompt[:240]}"
        messages = ([{"role": "system", "content": system}] if system else []) + [
            {"role": "user", "content": prompt}
        ]
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                _URL,
                headers={"Authorization": f"Bearer {self._key}"},
                json={"model": self._model, "messages": messages, "temperature": temperature},
            )
            r.raise_for_status()
            data = r.json()
        return data["choices"][0]["message"]["content"]

    async def stream(self, prompt: str, *, system: str | None = None,
                     temperature: float = 0.0) -> AsyncIterator[str]:
        text = await self.complete(prompt, system=system, temperature=temperature)
        for word in text.split(" "):
            yield word + " "
