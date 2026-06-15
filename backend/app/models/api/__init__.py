"""Hosted model clients (api lane).

Available adapters:
  gemini       — GeminiLLM (chat / slots / routing / SQL, primary brain)
  groq         — GroqLLM (low-latency / outage fallback brain)
  sarvam       — SarvamSTT, SarvamTTS, SarvamTranslator (primary voice)
  bhashini     — BhashiniSTT, BhashiniTTS, BhashiniTranslator (fallback voice)
  ollama_cloud — OllamaCloudLLM (qwen3-coder-next Text-to-SQL option)
"""
