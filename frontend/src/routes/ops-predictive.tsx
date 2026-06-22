import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { Radar } from "lucide-react";
import { useT } from "@/lib/i18n";
import { PredictivePanel } from "@/components/ops/PredictivePanel";

export const Route = createFileRoute("/ops-predictive")({
  head: () => ({ meta: [{ title: "Predictive Analytics · Satyam" }] }),
  component: PredictiveScreen,
});

function PredictiveScreen() {
  const t = useT();
  return (
    <Shell>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-foreground bg-[var(--main)] text-foreground">
            <Radar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-none">{t("Predictive Deployment")}</h1>
            <p className="text-xs text-muted-foreground">
              {t("Crime hotspots forecasting · resource allocation planning")}
            </p>
          </div>
        </header>
        <PredictivePanel />
      </div>
    </Shell>
  );
}
