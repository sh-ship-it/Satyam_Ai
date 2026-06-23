// Single shared webcam stream for ALL hands-free controllers.
// Browsers conflict if multiple components each call getUserMedia, so every
// consumer (GestureController, FacePresenceController) acquires through here.
// Tracks are stopped only when the reference count returns to zero.

import { CAMERA_CONSTRAINTS } from "@/config/handsFreeConfig";

let _stream: MediaStream | null = null;
let _refCount = 0;
let _pending: Promise<MediaStream> | null = null;

/** Acquire (or reuse) the shared camera stream. Increments the ref count. */
export async function acquireCamera(): Promise<MediaStream> {
  _refCount += 1;
  if (_stream && _stream.active) return _stream;
  if (_pending) return _pending;

  _pending = navigator.mediaDevices
    .getUserMedia(CAMERA_CONSTRAINTS)
    .then((s) => {
      _stream = s;
      _pending = null;
      return s;
    })
    .catch((err) => {
      _pending = null;
      _refCount = Math.max(0, _refCount - 1);
      throw err;
    });
  return _pending;
}

/** Release one reference. Stops all tracks when the last consumer leaves. */
export function releaseCamera(): void {
  _refCount = Math.max(0, _refCount - 1);
  if (_refCount === 0 && _stream) {
    for (const track of _stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    }
    _stream = null;
  }
}

/** True while at least one consumer holds the camera. */
export function isCameraActive(): boolean {
  return _refCount > 0 && !!_stream;
}

/**
 * Attach the shared stream to a (hidden) <video> element and resolve once it
 * is actually playing, so detectors never read an empty frame.
 */
export async function attachVideo(video: HTMLVideoElement): Promise<void> {
  const stream = await acquireCamera();
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {
    /* autoplay may need a user gesture; controllers handle retry */
  });
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener("loadeddata", onReady);
        resolve();
      };
      video.addEventListener("loadeddata", onReady);
    });
  }
}
