import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";
import { Truck } from "lucide-react";
import { useT } from "@/lib/i18n";
import { DispatchPanel } from "@/components/ops/DispatchPanel";

export const Route = createFileRoute("/ops-dispatch")({
  head: () => ({ meta: [{ title: "Dispatch & Green Corridor · Satyam" }] }),
  component: DispatchScreen,
});

function DispatchScreen() {
  const t = useT();
  return (
    <Shell>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border-2 border-foreground bg-[var(--main)] text-foreground">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-none">{t("Dispatch & Green Corridor")}</h1>
            <p className="text-xs text-muted-foreground">{t("Dispatch patrol units · priority signal corridor · live tracking")}</p>
          </div>
        </header>
        <DispatchPanel />
      </div>
    </Shell>
  );
}
