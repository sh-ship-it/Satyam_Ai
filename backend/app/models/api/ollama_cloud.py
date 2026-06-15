"""Ollama Cloud client — qwen3-coder-next Text-to-SQL option.

Model: qwen3-coder-next:cloud (80B total / 3B active MoE, 256K context,
tool-calling). Free-tier: "light usage", 5-hour session + weekly resets,
1 concurrent model. Expose as the SQL_ENGINE=qwen3-coder-next option.

The sqlglot guard + validate/repair loop apply identically regardless of
which SQL_ENGINE is selected — safety never depends on the model choice.

If OLLAMA_CLOUD_API_KEY is unset the client runs in demo mode.
"""
from __future__ import annotations

from typing import AsyncIterator

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings


class OllamaCloudLLM:
    """OpenAI-compatible Ollama Cloud endpoint for qwen3-coder-next."""

    def __init__(self) -> None:
        s = get_settings()
        self._key = s.ollama_cloud_api_key
        self._base = s.ollama_cloud_url.rstrip("/")
        self._model = s.ollama_cloud_sql_model
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
            return f'[demo:ollama-cloud] {{"sql": "SELECT * FROM cases LIMIT 5"}}'

        messages = (
            [{"role": "system", "content": system}] if system else []
        ) + [{"role": "user", "content": prompt}]

        body: dict = {
            "model": self._model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }
        if json_schema:
            # Ollama Cloud supports OpenAI-style JSON mode
            body["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{self._base}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

    async def stream(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float = 0.0,
    ) -> AsyncIterator[str]:
        text = await self.complete(prompt, system=system, temperature=temperature)
        for word in text.split(" "):
            yield word + " "
