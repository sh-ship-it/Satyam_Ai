import { useEffect, useRef, useState } from "react";
import { Camera, Upload, X, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/api/client";

export const ROLE_OPTIONS = [
  { value: "DGP",  label: "DGP — Director General (state)" },
  { value: "IGP",  label: "IGP — Inspector General (state)" },
  { value: "DIG",  label: "DIG — Dy. Inspector General (range)" },
  { value: "SP",   label: "SP — Superintendent (district)" },
  { value: "DySP", label: "DySP — Dy. Superintendent (district)" },
  { value: "CI",   label: "CI / PI — Circle/Police Inspector (station)" },
  { value: "PSI",  label: "PSI / SI — Sub-Inspector (station)" },
  { value: "ASI",  label: "ASI — Asst. Sub-Inspector (station)" },
  { value: "HC",   label: "HC — Head Constable (station)" },
  { value: "PC",   label: "PC — Police Constable (station)" },
];

const ROLE_BY_VALUE = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r]));

export const ROLE_GROUPS: { label: string; roles: typeof ROLE_OPTIONS }[] = [
  { label: "Highest access", roles: ["DGP", "IGP", "DIG", "SP"].map((v) => ROLE_BY_VALUE[v]) },
  { label: "Medium access",  roles: ["DySP", "CI"].map((v) => ROLE_BY_VALUE[v]) },
  { label: "Low access",     roles: ["PSI", "ASI", "HC", "PC"].map((v) => ROLE_BY_VALUE[v]) },
];

export function CreateAccountDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [stationId, setStationId] = useState<string>("");      // "" = none
  const [stations, setStations] = useState<{ station_id: number; station_name: string; district: string }[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start/stop the webcam
  useEffect(() => {
    if (!open || !camOn) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setErr(t("Camera unavailable — check browser permissions."));
        setCamOn(false);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [open, camOn, t]);

  // Stop camera when dialog closes
  useEffect(() => {
    if (!open) {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      setCamOn(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    api.stations().then(setStations).catch(() => setStations([]));
  }, [open]);

  const stationsByDistrict = stations.reduce<Record<string, typeof stations>>((acc, s) => {
    (acc[s.district] ??= []).push(s); return acc;
  }, {});

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 320;
    canvas.height = v.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      setPhoto(canvas.toDataURL("image/jpeg", 0.85));
    }
    setCamOn(false);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!name || !email || !password || !role) {
      setErr(t("Please fill in all required fields."));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.register({
        name,
        email,
        role,
        password,
        photo_b64: photo ?? undefined,
        station_id: stationId ? Number(stationId) : undefined,
      });
      onCreated();
    } catch (e: any) {
      const detail = e?.body?.detail || e?.message || "";
      if (detail.includes("already taken")) {
        setErr(t("This username is already taken. Try a different name or email."));
      } else if (detail.includes("Password")) {
        setErr(t("Password is required."));
      } else if (detail) {
        setErr(detail);
      } else {
        setErr(t("Could not create the account. Try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-[5px] border-2 border-foreground bg-secondary-background p-6 nb-shadow-lg text-foreground">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{t("Create account")}</h3>
          <button onClick={onClose} className="rounded-[5px] p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Photo: upload OR camera */}
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[5px] border-2 border-foreground bg-background">
            {camOn ? (
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            ) : photo ? (
              <img src={photo} alt="profile" className="h-full w-full object-cover" />
            ) : (
              <Camera className="h-7 w-7 text-foreground/40" />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-background px-2.5 py-1.5 text-xs font-bold nb-shadow-sm select-none">
              <Upload className="h-3.5 w-3.5" /> {t("Upload photo")}
              <input type="file" accept="image/*" className="hidden" onChange={onFile} />
            </label>
            {camOn ? (
              <button
                onClick={capture}
                className="inline-flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground nb-shadow-sm"
              >
                <Camera className="h-3.5 w-3.5" /> {t("Capture")}
              </button>
            ) : (
              <button
                onClick={() => setCamOn(true)}
                className="inline-flex items-center gap-1.5 rounded-[5px] border-2 border-foreground bg-background px-2.5 py-1.5 text-xs font-bold nb-shadow-sm"
              >
                <Camera className="h-3.5 w-3.5" /> {photo ? t("Retake") : t("Use camera")}
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("Full name")}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder={t("Email address")}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder={t("Password")}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
          >
            <option value="" disabled>{t("Select your rank / role")}</option>
            {ROLE_GROUPS.map((g) => (
              <optgroup key={g.label} label={t(g.label)}>
                {g.roles.map((r) => (
                  <option key={r.value} value={r.value}>{t(r.label)}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            className="h-10 w-full rounded-[5px] border-2 border-foreground bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring nb-shadow-sm"
          >
            <option value="">{t("Select police station (optional)")}</option>
            {Object.keys(stationsByDistrict).sort().map((district) => (
              <optgroup key={district} label={district}>
                {stationsByDistrict[district].map((s) => (
                  <option key={s.station_id} value={String(s.station_id)}>
                    {s.station_name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {err && <p className="mt-3 text-xs font-medium text-destructive">{err}</p>}

        <button
          onClick={submit}
          disabled={busy || !name || !email || !password || !role}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-[5px] border-2 border-foreground bg-primary text-sm font-extrabold uppercase text-primary-foreground nb-shadow disabled:opacity-60 disabled:cursor-not-allowed select-none"
        >          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
          {t("Create account")}
        </button>
      </div>
    </div>
  );
}
