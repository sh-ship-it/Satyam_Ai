import asyncio
import os
from dotenv import load_dotenv

# Load env file
load_dotenv()

from app.config import get_settings
from app.models.registry import get_stt

async def main():
    settings = get_settings()
    print("Sarvam API key set:", bool(settings.sarvam_api_key))
    if settings.sarvam_api_key:
        print("Key prefix:", settings.sarvam_api_key[:8])
        
    engine = get_stt("sarvam")
    print("STT engine resolved:", type(engine).__name__)
    
    # Generate a tiny dummy mono 16kHz WAV header + silence
    # 44 bytes header + some silence samples (e.g. 16000 samples = 1 second)
    sample_rate = 16000
    num_samples = 16000
    pcm_data = b'\x00\x00' * num_samples
    
    wav_header = bytearray()
    wav_header.extend(b'RIFF')
    wav_header.extend((36 + len(pcm_data)).to_bytes(4, 'little'))
    wav_header.extend(b'WAVE')
    wav_header.extend(b'fmt ')
    wav_header.extend((16).to_bytes(4, 'little'))
    wav_header.extend((1).to_bytes(2, 'little'))
    wav_header.extend((1).to_bytes(2, 'little'))
    wav_header.extend(sample_rate.to_bytes(4, 'little'))
    wav_header.extend((sample_rate * 2).to_bytes(4, 'little'))
    wav_header.extend((2).to_bytes(2, 'little'))
    wav_header.extend((16).to_bytes(2, 'little'))
    wav_header.extend(b'data')
    wav_header.extend(len(pcm_data).to_bytes(4, 'little'))
    
    wav_bytes = bytes(wav_header + pcm_data)
    
    try:
        print("Sending dummy audio of size:", len(wav_bytes))
        transcript, detected_lang = await engine.transcribe_with_lang(wav_bytes, lang="auto")
        print("API Response - Transcript:", repr(transcript))
        print("API Response - Detected Language:", detected_lang)
    except Exception as e:
        print("API call failed with exception:", e)

if __name__ == "__main__":
    asyncio.run(main())
