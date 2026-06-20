import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState } from "react";
import { Siren, Radar, Truck, TrafficCone, Video } from "lucide-react";
import { useT } from "@/lib/i18n";
import { PredictivePanel } from "@/components/ops/PredictivePanel";

export const Route = createFileRoute("/operations")({
  head: () => ({ meta: [{ title: "Response Ops · Satyam" }] }),
  component: OperationsScreen,
});

type Tab = "predict" | "dispatch" | "corridor" | "review";

function OperationsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("predict");

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "predict", label: t("Predictive Deployment"), icon: Radar },
    { id: "dispatch", label: t("Dispatch & Tracking"), icon: Truck },
    { id: "corridor", label: t("Green Corridor"), icon: TrafficCone },
    { id: "review", label: t("Camera Review"), icon: Video },
  ];

  return (
    <Shell>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-foreground bg-[var(--main)] text-foreground">
            <Siren className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-none">{t("Response Ops")}</h1>
            <p className="text-xs text-muted-foreground">{t("Predict · Detect · Dispatch · Clear the route")}</p>
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-[6px] border-2 border-foreground px-3 py-1.5 text-sm font-bold transition ${
                tab === id ? "bg-foreground text-background" : "bg-background hover:bg-muted"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>

        <section className="rounded-[8px] border-2 border-foreground bg-background p-4">
          {tab === "predict" && <PredictivePanel />}
          {tab !== "predict" && (
            <p className="text-sm text-muted-foreground">{t("Coming in a later phase.")} ({tab})</p>
          )}
        </section>
      </div>
    </Shell>
  );
}
