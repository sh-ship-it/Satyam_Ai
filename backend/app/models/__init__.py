"""Model adapter layer.

One stable set of interfaces (base.py) with two interchangeable backends:
  - api/   : hosted models (Gemini, Groq, Bhashini)  [default]
  - local/ : on-prem weights (vLLM/Ollama, BGE-M3, Whisper, Parler)  [add later]
The pipeline only ever imports `registry`, never a concrete model, so swapping
lanes is a one-line env change (MODEL_BACKEND).
"""
