import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { useState } from "react";
import { Siren, Radar, Truck, Video, Map as MapIcon } from "lucide-react";
import { useT } from "@/lib/i18n";
import { LiveOperationsMap } from "@/components/ops/LiveOperationsMap";
import { PredictivePanel } from "@/components/ops/PredictivePanel";
import { DispatchPanel } from "@/components/ops/DispatchPanel";
import { ReviewPanel } from "@/components/ops/ReviewPanel";

export const Route = createFileRoute("/operations")({
  head: () => ({ meta: [{ title: "Response Ops · Satyam" }] }),
  component: OperationsScreen,
});

type Tab = "live" | "predict" | "dispatch" | "review";

function OperationsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("live");

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: "live", label: t("Live Map"), icon: MapIcon },
    { id: "predict", label: t("Predictive Deployment"), icon: Radar },
    { id: "dispatch", label: t("Dispatch & Green Corridor"), icon: Truck },
    { id: "review", label: t("Camera Review"), icon: Video },
  ];

  const tabBar = (
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
  );

  // Live Map fills the viewport below the app header (no card padding).
  if (tab === "live") {
    return (
      <Shell>
        <div className="relative flex h-full min-h-0 flex-1 flex-col">
          <div className="absolute left-1/2 top-3 z-[1100] -translate-x-1/2">{tabBar}</div>
          <div className="relative flex-1">
            <LiveOperationsMap />
          </div>
        </div>
      </Shell>
    );
  }

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

        {tabBar}

        <section className="rounded-[8px] border-2 border-foreground bg-background p-4">
          {tab === "predict" && <PredictivePanel />}
          {tab === "dispatch" && <DispatchPanel />}
          {tab === "review" && <ReviewPanel />}
        </section>
      </div>
    </Shell>
  );
}
