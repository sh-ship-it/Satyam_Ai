"""Abstract model interfaces shared by the api and local backends."""
from __future__ import annotations

from typing import AsyncIterator, Protocol, runtime_checkable


@runtime_checkable
class LLM(Protocol):
    async def complete(self, prompt: str, *, system: str | None = None,
                       temperature: float = 0.0, json_schema: dict | None = None) -> str: ...

    async def stream(self, prompt: str, *, system: str | None = None,
                     temperature: float = 0.0) -> AsyncIterator[str]: ...


@runtime_checkable
class Embedder(Protocol):
    dim: int
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


@runtime_checkable
class Reranker(Protocol):
    async def rerank(self, query: str, docs: list[str]) -> list[int]: ...


@runtime_checkable
class SpeechToText(Protocol):
    async def transcribe(self, audio: bytes, *, lang: str = "kn") -> str: ...


@runtime_checkable
class TextToSpeech(Protocol):
    async def synthesize(self, text: str, *, lang: str = "kn") -> bytes: ...


@runtime_checkable
class Translator(Protocol):
    async def translate(self, text: str, *, src: str, tgt: str) -> str: ...
