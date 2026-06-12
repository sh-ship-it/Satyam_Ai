"""Local LLM via an OpenAI-compatible server (vLLM / Ollama). DEMO stub.

Point OPENAI_BASE_URL at your vLLM/Ollama endpoint and implement the HTTP call.
Until then this returns a deterministic echo so the pipeline runs offline.
"""
from __future__ import annotations

from typing import AsyncIterator


class LocalLLM:
    async def complete(self, prompt: str, *, system: str | None = None,
                       temperature: float = 0.0, json_schema: dict | None = None) -> str:
        return f"[demo:local-llm] {prompt[:240]}"

    async def stream(self, prompt: str, *, system: str | None = None,
                     temperature: float = 0.0) -> AsyncIterator[str]:
        text = await self.complete(prompt, system=system, temperature=temperature)
        for word in text.split(" "):
            yield word + " "
