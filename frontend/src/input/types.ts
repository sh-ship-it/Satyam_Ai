// Shared types for the hands-free multimodal input layer (gesture + face presence).
// All input controllers (GestureController, FacePresenceController, wake word)
// feed the SAME event bus the voice copilot already uses (satyam:run-task,
// satyam:open-voice, navigation), so gestures are just another input source.

/** A single MediaPipe normalized landmark (x,y in [0,1]; z relative depth). */
export type Landmark = { x: number; y: number; z?: number };

/** The static hand gestures the geometry classifier can emit. */
export type GestureName =
  | "point"
  | "two_finger"
  | "pinch"
  | "fist"
  | "open_palm"
  | "thumb_up"
  | "thumb_down"
  | "peace"
  | "three"
  | "swipe_left"
  | "swipe_right"
  | null;

/** Context handed to the gesture→action mapper on every fired gesture. */
export type GestureContext = {
  /** Current TanStack route, e.g. "/console". */
  route: string;
  /** UI language for spoken/toast feedback. */
  lang: "en" | "kn";
  /** True when War-room / presentation mode is active (different action map). */
  presentation: boolean;
  /** Latest index-fingertip (landmark 8) for cursor mapping, viewport coords. */
  cursor?: { x: number; y: number } | null;
};

/** Persisted hands-free preferences (localStorage: "satyam.handsfree"). */
export type HandsFreeSettings = {
  /** Master switch — when false NO camera is acquired. */
  enabled: boolean;
  /** Hand-gesture navigation + cursor control. */
  gestures: boolean;
  /** Always-on wake word ("Satyam…") to arm the voice mic. */
  wakeWord: boolean;
  /** Face-presence auto-lock: blur PII + lock when officer leaves the camera. */
  presenceLock: boolean;
  /** Seconds of continuous absence before auto-lock fires. */
  absenceSeconds: number;
  /** Show the on-screen cursor dot while pointing. */
  showCursor: boolean;
  /** Speak gesture confirmations aloud (in addition to toasts). */
  speakFeedback: boolean;
};
