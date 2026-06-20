import { useEffect, useState } from "react";
import { Video, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { responseOps, openOpsSocket, type ReviewItem, type CameraInfo } from "@/lib/api/responseOps";
import { useT } from "@/lib/i18n";

export function ReviewPanel() {
  const t = useT();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [cams, setCams] = useState<CameraInfo[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const [q, c] = await Promise.all([responseOps.reviewQueue(), responseOps.cameras()]);
      setItems(q); setCams(c);
    } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ws = openOpsSocket();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "INCIDENT_CANDIDATE") load();
    };
    return () => ws.close();
  }, []);

  async function confirm(id: number) { await responseOps.confirmReview(id, true); setItems((p) => p.filter((i) => i.id !== id)); }
  async function reject(id: number) { await responseOps.rejectReview(id); setItems((p) => p.filter((i) => i.id !== id)); }

  const tier = (c: number) => (c >= 0.8 ? { label: t("High"), cls: "bg-destructive text-destructive-foreground" }
                                        : { label: t("Medium"), cls: "bg-warning text-foreground" });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="inline-flex items-center gap-2 text-sm font-extrabold"><Video className="h-4 w-4" /> {t("Incident review queue")}</h3>
        <button onClick={load} disabled={busy} className="inline-flex items-center gap-1 rounded-[6px] border-2 border-foreground px-2 py-1 text-xs font-bold hover:bg-muted">
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> {t("Refresh")}
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">{cams.length} {t("cameras online")} · {t("AI flags candidates; a human confirms.")}</p>

      {items.length === 0 && <p className="text-xs text-muted-foreground">{t("No candidates awaiting review.")}</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((it) => {
          const tg = tier(it.confidence);
          return (
            <div key={it.id} className="rounded-[8px] border-2 border-foreground bg-background p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1 font-extrabold"><AlertTriangle className="h-4 w-4" /> {it.camera_id}</span>
                <span className={`rounded-[4px] px-2 py-0.5 text-[10px] font-bold ${tg.cls}`}>{tg.label} · {(it.confidence * 100).toFixed(0)}%</span>
              </div>
              <div className="mb-2 aspect-video w-full overflow-hidden rounded-[4px] border-2 border-foreground bg-muted">
                {it.frame_path
                  ? <img src={it.frame_path} alt="frame" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">{t("No preview")}</div>}
              </div>
              <div className="mb-2 text-[11px] text-muted-foreground">{it.candidate_type}{it.lat ? ` · ${it.lat.toFixed(3)}, ${it.lng?.toFixed(3)}` : ""}</div>
              <div className="flex gap-2">
                <button onClick={() => confirm(it.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-[var(--destructive,#FF4D50)] px-2 py-1 text-xs font-bold text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("Confirm → file case")}
                </button>
                <button onClick={() => reject(it.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-[6px] border-2 border-foreground bg-background px-2 py-1 text-xs font-bold hover:bg-muted">
                  <XCircle className="h-3.5 w-3.5" /> {t("Reject")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
